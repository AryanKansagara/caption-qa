import { useSyncExternalStore } from 'react'
import type { RuleId } from './engine/check.ts'
import type { Rules } from './engine/rules.ts'
import type { Cue, Format, ParseIssue } from './engine/types.ts'

export interface Track {
  id: string
  lang: string
  role: 'source' | 'target'
  fileName: string
  format: Format
  encoding?: string
  cues: Cue[]
  /** As imported; kept so the reviewer can diff and revert. */
  original: Cue[]
  parseIssues: ParseIssue[]
  /** Fix keys the reviewer rejected. */
  rejected: string[]
}

export interface SnapshotTrack { id: string; lang: string; role: Track['role']; fileName: string; format: Format; cues: Cue[]; score: number; counts: Partial<Record<RuleId, number>>; errors: number; warnings: number }
export interface Snapshot { id: string; label: string; at: number; profileId: string; tracks: SnapshotTrack[] }

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  profileId: string
  /** Edits on top of the chosen profile (the "custom" profile). */
  overrides: Partial<Rules>
  kids: boolean
  shots: number[]
  tracks: Track[]
  snapshots: Snapshot[]
  sampleId?: string
  /** Cue data was too large to sync; it lives on the device that imported it. */
  tracksLocal?: boolean
}

// ---------- Tiny IndexedDB wrapper (falls back to memory in private modes) ----------

const DB = 'caption-qa'
let dbp: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  return dbp ??= new Promise(res => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore('projects', { keyPath: 'id' }) }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
    } catch { res(null) }
  })
}
const mem = new Map<string, Project>()

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  if (!d) throw new Error('no-idb')
  return new Promise((res, rej) => {
    const r = fn(d.transaction('projects', mode).objectStore('projects'))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
const idbAll = async () => { try { return await tx('readonly', s => s.getAll()) as Project[] } catch { return [...mem.values()] } }
const idbPut = async (p: Project) => { try { await tx('readwrite', s => s.put(p)) } catch { mem.set(p.id, p) } }
const idbDel = async (id: string) => { try { await tx('readwrite', s => s.delete(id)) } catch { mem.delete(id) } }

// ---------- In-memory project list with subscribers ----------

let projects: Project[] = []
let loaded = false
const subs = new Set<() => void>()
const emit = () => { projects = [...projects]; subs.forEach(f => f()) }
const changeHooks = new Set<(p: Project) => void>()
export const onProjectChange = (f: (p: Project) => void) => { changeHooks.add(f); return () => changeHooks.delete(f) }

export async function loadProjects() {
  projects = (await idbAll()).sort((a, b) => b.updatedAt - a.updatedAt)
  loaded = true
  emit()
}

export const useProjects = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => loaded ? projects : null)
export const getProjects = () => projects
export const getProject = (id: string) => projects.find(p => p.id === id)

export async function saveProject(p: Project, opts: { touch?: boolean; silent?: boolean } = {}) {
  const next = opts.touch === false ? p : { ...p, updatedAt: Date.now() }
  const i = projects.findIndex(x => x.id === p.id)
  if (i >= 0) projects[i] = next
  else projects.unshift(next)
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  emit()
  await idbPut(next)
  if (!opts.silent) changeHooks.forEach(f => f(next))
  return next
}

/** Deletes locally; returns an undo function. */
export async function deleteProject(id: string): Promise<() => Promise<void>> {
  const p = getProject(id)
  projects = projects.filter(x => x.id !== id)
  emit()
  await idbDel(id)
  addTombstone(id)
  return async () => { if (!p) return; removeTombstone(id); await saveProject(p) }
}

export const uuid = () => crypto.randomUUID()

// Tombstones keep a project deleted offline from coming back on the next sync.
const TOMB = 'caption-qa.tombstones'
export const tombstones = (): string[] => { try { return JSON.parse(localStorage.getItem(TOMB) ?? '[]') } catch { return [] } }
const addTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify([...new Set([...tombstones(), id])]))
const removeTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => x !== id)))
export const clearTombstones = (ids: string[]) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => !ids.includes(x))))

// ---------- App defaults (settings page) ----------

export interface Defaults { profileId: string; kids: boolean; exportFormat: Format | 'same'; sourceLang: string }
const DEF_KEY = 'caption-qa.defaults'
export function getDefaults(): Defaults {
  const base: Defaults = { profileId: 'netflix', kids: false, exportFormat: 'same', sourceLang: 'en' }
  try { return { ...base, ...JSON.parse(localStorage.getItem(DEF_KEY) ?? '{}') } } catch { return base }
}
export const setDefaults = (d: Defaults) => localStorage.setItem(DEF_KEY, JSON.stringify(d))
