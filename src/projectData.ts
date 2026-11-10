import { useMemo } from 'react'
import { check, expansion, score, summarize, type Issue, type RuleId, type RuleSummary } from './engine/check.ts'
import { autoFix } from './engine/fix.ts'
import { parse, parseBytes } from './engine/parse.ts'
import { PROFILES, rulesFor, type Profile, type Rules } from './engine/rules.ts'
import { SAMPLE_FILES, SAMPLE_SHOTS } from './engine/sample.ts'
import { guessLang } from './engine/text.ts'
import type { ParseResult } from './engine/types.ts'
import { getDefaults, getProjects, saveProject, useProjects, uuid, type Project, type Snapshot, type Track } from './store.ts'

export const SAMPLE_ID = 'mill-lane'

export const getProfile = (p: Pick<Project, 'profileId'>): Profile => PROFILES.find(x => x.id === p.profileId) ?? PROFILES[0]
export const isCustom = (p: Project) => Object.keys(p.overrides).length > 0
export const trackRules = (p: Project, lang: string): Rules => ({ ...rulesFor(getProfile(p), lang, p.kids), ...p.overrides })
export const sourceOf = (p: Project) => p.tracks.find(t => t.role === 'source')

export function trackFrom(r: ParseResult, fileName: string, lang: string, role: Track['role']): Track {
  return { id: uuid(), lang, role, fileName, format: r.format, encoding: r.encoding, cues: r.cues, original: r.cues, parseIssues: r.issues, rejected: [] }
}

export interface TrackQC {
  track: Track
  rules: Rules
  issues: Issue[]
  byCue: Map<string, Issue[]>
  score: number
  summary: RuleSummary[]
  errors: number
  warnings: number
  expansion: number | null
}

export function qcTrack(p: Project, t: Track): TrackQC {
  const src = t.role === 'target' ? sourceOf(p) : undefined
  const rules = trackRules(p, t.lang)
  const issues = check(t.cues, rules, { lang: t.lang, shots: p.shots, source: src?.cues, sourceLang: src?.lang })
  const byCue = new Map<string, Issue[]>()
  for (const i of issues) byCue.set(i.cueId, [...(byCue.get(i.cueId) ?? []), i])
  const errors = issues.filter(i => i.severity === 'error').length
  return {
    track: t, rules, issues, byCue, errors, warnings: issues.length - errors,
    score: score(t.cues, issues),
    summary: summarize(issues, !!src),
    expansion: src ? expansion(t.cues, src.cues).overall : null,
  }
}

export const useQC = (p: Project | null | undefined) => useMemo(() => p ? p.tracks.map(t => qcTrack(p, t)) : [], [p])

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  return { loading: list === null, project }
}

export function snapshotOf(p: Project, label: string): Snapshot {
  return {
    id: uuid(), label, at: Date.now(), profileId: p.profileId,
    tracks: p.tracks.map(t => {
      const q = qcTrack(p, t)
      const counts: Partial<Record<RuleId, number>> = {}
      for (const i of q.issues) counts[i.rule] = (counts[i.rule] ?? 0) + 1
      return { id: t.id, lang: t.lang, role: t.role, fileName: t.fileName, format: t.format, cues: t.cues, score: q.score, counts, errors: q.errors, warnings: q.warnings }
    }),
  }
}

export async function createSampleProject(): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === SAMPLE_ID)
  if (existing) return existing
  const now = Date.now()
  const tracks = SAMPLE_FILES.map(f => trackFrom(parse(f.text, null, f.name), f.name, f.lang, f.role))
  const p: Project = { id: uuid(), name: 'Mill Lane (synthetic sample)', createdAt: now, updatedAt: now, profileId: 'netflix', overrides: {}, kids: false, shots: SAMPLE_SHOTS, tracks, snapshots: [], sampleId: SAMPLE_ID }
  const v1 = { ...snapshotOf(p, 'v1 · vendor delivery'), at: now - 3 * 86400000 }
  // v2 shows what an auto-fix pass did; the working copy stays as delivered so you can run it yourself.
  const fixed = { ...p, tracks: tracks.map(t => ({ ...t, cues: autoFix(t.cues, trackRules(p, t.lang), { lang: t.lang, shots: p.shots }).cues })) }
  const v2 = { ...snapshotOf(fixed, 'v2 · after auto-fix'), at: now - 2 * 86400000 }
  return saveProject({ ...p, snapshots: [v1, v2] })
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  const d = getDefaults()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, profileId: d.profileId, overrides: {}, kids: d.kids, shots: [], tracks: [], snapshots: [] })
}

export interface PendingFile { key: string; fileName: string; size: number; result: ParseResult; lang: string; role: Track['role'] }

export async function readSubtitleFile(file: File, hasSource: boolean): Promise<PendingFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = parseBytes(bytes, file.name)
  const sample = result.cues.slice(0, 80).map(c => c.text).join('\n')
  const lang = guessLang(sample, file.name) ?? getDefaults().sourceLang
  return { key: uuid(), fileName: file.name, size: file.size, result, lang, role: !hasSource && lang === getDefaults().sourceLang ? 'source' : 'target' }
}

// ---------- Track edits with an undo stack (per session) ----------

const stacks = new Map<string, { label: string; tracks: Track[] }[]>()
export const undoDepth = (id: string) => stacks.get(id)?.length ?? 0
export const undoLabel = (id: string) => stacks.get(id)?.at(-1)?.label

export async function updateTracks(p: Project, tracks: Track[], label: string) {
  const s = stacks.get(p.id) ?? []
  s.push({ label, tracks: p.tracks })
  if (s.length > 100) s.shift()
  stacks.set(p.id, s)
  return saveProject({ ...p, tracks })
}

export async function undoTracks(p: Project): Promise<string | null> {
  const prev = stacks.get(p.id)?.pop()
  if (!prev) return null
  await saveProject({ ...p, tracks: prev.tracks })
  return prev.label
}

export const replaceTrack = (p: Project, t: Track) => p.tracks.map(x => x.id === t.id ? t : x)
