import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { TABS, type Tab } from './App.tsx'
import { RULES, ruleLabel, type RuleId } from './engine/check.ts'
import { autoFix } from './engine/fix.ts'
import { fmtTime } from './engine/parse.ts'
import { langName } from './engine/rules.ts'
import { serialize } from './engine/serialize.ts'
import { FORMAT_EXT, FORMAT_LABEL, type Cue, type Format } from './engine/types.ts'
import { getProfile, isCustom, qcTrack, snapshotOf, undoDepth, undoLabel, undoTracks, updateTracks, useProject, useQC, type TrackQC } from './projectData.ts'
import { getDefaults, saveProject, type Project, type Snapshot } from './store.ts'
import { deleteSnapshotCloud } from './sync.ts'
import { ask, CopyButton, download, Empty, go, isTyping, Link, NotFound, SyntheticBadge, toast } from './ui.tsx'

const Review = lazy(() => import('./Review.tsx'))
const Fixes = lazy(() => import('./Fixes.tsx'))
const Setup = lazy(() => import('./Setup.tsx'))

const TAB_LABEL: Record<Tab, string> = { overview: 'QC overview', review: 'Review', fixes: 'Fixes', batch: 'Batch', history: 'History', export: 'Export', setup: 'Setup' }

export const scoreClass = (s: number) => s >= 80 ? 'good' : s >= 50 ? 'mid' : 'bad'
export const fmtT = (ms: number) => fmtTime(ms).slice(3, 11).replace(/^00:/, '0:')
export const plainText = (t: string) => t.replace(/<[^>]+>/g, '')

/** Selected track, kept in the URL so links can point at one language. */
export function useTrackParam(p: Project): [string, (id: string) => void] {
  const fromUrl = new URLSearchParams(location.search).get('track')
  const first = p.tracks.find(t => t.role === 'target') ?? p.tracks[0]
  const [id, setId] = useState(() => p.tracks.some(t => t.id === fromUrl) ? fromUrl! : first?.id ?? '')
  const valid = p.tracks.some(t => t.id === id) ? id : first?.id ?? ''
  return [valid, (v: string) => { setId(v); const u = new URL(location.href); u.searchParams.set('track', v); history.replaceState({}, '', u) }]
}

export function TrackPicker({ p, qc, value, onChange }: { p: Project; qc: TrackQC[]; value: string; onChange(id: string): void }) {
  return (
    <div className="seg-control" role="radiogroup" aria-label="Track">
      {p.tracks.map(t => {
        const q = qc.find(x => x.track.id === t.id)
        return <button key={t.id} type="button" role="radio" aria-checked={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.lang.toUpperCase()} <small className="muted">{t.role === 'source' ? 'source' : q ? q.score : ''}</small>
        </button>
      })}
    </div>
  )
}

export default function ProjectView({ id, tab }: { id: string; tab: Tab }) {
  const { loading, project: p } = useProject(id)
  const qc = useQC(p)

  useEffect(() => { if (p) document.title = `${p.name} · ${TAB_LABEL[tab]} · Caption QA` }, [p?.name, tab])
  useEffect(() => {
    if (!p) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) { go(`/app/p/${p.id}/${TABS[n - 1]}`, { keepScroll: true }); return }
      if (e.key === 'p') go(`/app/p/${p.id}/report`)
      if (e.key === 's') void saveSnapshot(p)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [p])

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Opening project</div>
  if (!p) return <NotFound />

  return (
    <section className="page wide">
      <div className="project-head">
        <div>
          <Link href="/app" className="crumb">&larr; Projects</Link>
          <h1>{p.name} {p.sampleId && <SyntheticBadge />}</h1>
          <p className="muted small">{getProfile(p).name}{isCustom(p) ? ' with custom edits' : ''}{p.kids ? ', children’s reading speeds' : ''} · {p.tracks.length} track{p.tracks.length === 1 ? '' : 's'} · {p.shots.length} shot changes</p>
        </div>
        <div className="row gap-sm wrap">
          <button type="button" className="btn ghost sm" disabled={!undoDepth(p.id)} title={undoLabel(p.id) ? `Undo: ${undoLabel(p.id)}` : 'Nothing to undo'} onClick={async () => { const l = await undoTracks(p); if (l) toast(`Undid: ${l}`) }}>Undo</button>
          <button type="button" className="btn ghost sm" onClick={() => void saveSnapshot(p)} title="Shortcut: S">Save snapshot</button>
          <Link href={`/app/p/${p.id}/report`} className="btn outline sm" title="Shortcut: P">QC report</Link>
        </div>
      </div>
      <nav className="tabs" aria-label="Project sections">
        {TABS.map((t, i) => <Link key={t} href={`/app/p/${p.id}/${t}${location.search}`} aria-current={tab === t ? 'page' : undefined} title={`Shortcut: ${i + 1}`}>{TAB_LABEL[t]}</Link>)}
      </nav>
      {!p.tracks.length && tab !== 'setup' ? (
        <Empty title="No subtitle tracks yet">
          <p className="muted">Import a source track and its translations to start QC.</p>
          <Link href={`/app/p/${p.id}/setup`} className="btn primary">Import files</Link>
        </Empty>
      ) : (
        <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
          {tab === 'overview' && <Overview p={p} qc={qc} />}
          {tab === 'review' && <Review p={p} qc={qc} />}
          {tab === 'fixes' && <Fixes p={p} qc={qc} />}
          {tab === 'batch' && <Batch p={p} qc={qc} />}
          {tab === 'history' && <History p={p} />}
          {tab === 'export' && <Export p={p} qc={qc} />}
          {tab === 'setup' && <Setup p={p} />}
        </Suspense>
      )}
    </section>
  )
}

export async function saveSnapshot(p: Project, label?: string) {
  const s = snapshotOf(p, label ?? `v${p.snapshots.length + 1} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`)
  await saveProject({ ...p, snapshots: [...p.snapshots, s] })
  toast(`Saved snapshot “${s.label}”`, { tone: 'ok' })
}

export function ScoreRing({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  return <div className={`score-ring ${size} ${scoreClass(score)}`} style={{ '--p': score } as React.CSSProperties}><b>{score}</b>{size === 'md' && <span>score</span>}</div>
}

// ---------- Overview ----------

function Overview({ p, qc }: { p: Project; qc: TrackQC[] }) {
  const [tid, setTid] = useTrackParam(p)
  const q = qc.find(x => x.track.id === tid) ?? qc[0]
  const [rule, setRule] = useState<RuleId | 'all'>('all')
  const [sev, setSev] = useState<'all' | 'error' | 'warn'>('all')
  const cueIndex = useMemo(() => new Map(q?.track.cues.map((c, i) => [c.id, i]) ?? []), [q])
  if (!q) return null
  const list = q.issues.filter(i => (rule === 'all' || i.rule === rule) && (sev === 'all' || i.severity === sev))
  const cueOf = (id: string) => q.track.cues[cueIndex.get(id) ?? -1] as Cue | undefined

  return (
    <div className="stack">
      <div className="track-cards">
        {qc.map(x => (
          <button key={x.track.id} type="button" className={`track-card${x.track.id === q.track.id ? ' on' : ''}`} onClick={() => setTid(x.track.id)}>
            <ScoreRing score={x.score} size="sm" />
            <span className="track-card-body">
              <strong>{langName(x.track.lang)} <small className="muted">{x.track.role}</small></strong>
              <small className="muted">{x.track.fileName} · {x.track.cues.length} cues</small>
              <small><span className={x.errors ? 'error' : 'good-text'}>{x.errors} errors</span> · {x.warnings} warnings{x.expansion !== null && <> · <span className={x.expansion > 1.25 ? 'warn-text' : ''}>{x.expansion >= 1 ? '+' : ''}{Math.round((x.expansion - 1) * 100)}% length</span></>}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="grid-side">
        <div className="panel">
          <div className="panel-head"><h2>Rules</h2><span className="muted small">{getProfile(p).short}, {langName(q.track.lang)}</span></div>
          <table className="rule-table">
            <thead><tr><th>Rule</th><th className="num">Err</th><th className="num">Warn</th><th>Result</th></tr></thead>
            <tbody>
              {q.summary.map(s => (
                <tr key={s.id} className={rule === s.id ? 'sel' : ''} onClick={() => setRule(rule === s.id ? 'all' : s.id)} style={{ cursor: 'pointer' }}>
                  <th><button type="button" className="linkish plain" aria-pressed={rule === s.id}>{ruleLabel(s.id)}</button></th>
                  <td className="num">{s.errors || ''}</td><td className="num">{s.warnings || ''}</td>
                  <td><span className={`badge ${s.pass ? (s.warnings ? 'moderate' : 'low') : 'severe'}`}>{s.pass ? (s.warnings ? 'Pass, review' : 'Pass') : 'Fail'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <RuleLimits q={q} />
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>{list.length} issue{list.length === 1 ? '' : 's'}{rule !== 'all' && <> in {ruleLabel(rule)}</>}</h2>
            <div className="row gap-sm wrap">
              <select aria-label="Filter by rule" value={rule} onChange={e => setRule(e.target.value as RuleId | 'all')}>
                <option value="all">All rules</option>
                {RULES.filter(r => q.summary.some(s => s.id === r.id)).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <select aria-label="Filter by severity" value={sev} onChange={e => setSev(e.target.value as typeof sev)}>
                <option value="all">Errors and warnings</option><option value="error">Errors</option><option value="warn">Warnings</option>
              </select>
              <Link href={`/app/p/${p.id}/fixes?track=${q.track.id}`} className="btn primary sm">Fix issues</Link>
            </div>
          </div>
          {list.length === 0 ? <Empty title="Nothing to fix here"><p className="muted">This track passes {rule === 'all' ? 'every rule' : ruleLabel(rule as RuleId)} in the current profile.</p></Empty> : (
            <ul className="issue-list">
              {list.slice(0, 300).map((i, k) => {
                const c = cueOf(i.cueId)
                return (
                  <li key={k} className={i.severity}>
                    <Link href={`/app/p/${p.id}/review?track=${q.track.id}&cue=${i.cueId}`} className="issue-time mono">#{(cueIndex.get(i.cueId) ?? 0) + 1} · {c ? fmtT(c.start) : ''}</Link>
                    <div>
                      <div><b>{ruleLabel(i.rule)}</b> <span className="muted">{i.message}</span></div>
                      {c && <div className="issue-text">{plainText(c.text).split('\n').map((l, j) => <span key={j}>{l}</span>)}</div>}
                    </div>
                  </li>
                )
              })}
              {list.length > 300 && <li className="muted small">Showing the first 300. Filter by rule to see the rest, or export the CSV.</li>}
            </ul>
          )}
        </div>
      </div>

      {q.track.parseIssues.length > 0 && (
        <details className="panel">
          <summary><b>Import validation report</b> <span className="muted">· {q.track.fileName} · {q.track.parseIssues.length} finding{q.track.parseIssues.length === 1 ? '' : 's'} ({q.track.encoding ?? 'UTF-8'}, {FORMAT_LABEL[q.track.format]})</span></summary>
          <ParseReport issues={q.track.parseIssues} />
        </details>
      )}
    </div>
  )
}

export function ParseReport({ issues }: { issues: Project['tracks'][number]['parseIssues'] }) {
  if (!issues.length) return <p className="good-text small">No problems found while reading the file.</p>
  return (
    <ul className="parse-report">
      {issues.slice(0, 200).map((i, k) => <li key={k} className={i.severity}><span className="mono">{i.line ? `Line ${i.line}` : 'File'}</span><span className="badge">{i.kind}</span><span>{i.message}</span></li>)}
      {issues.length > 200 && <li className="muted">and {issues.length - 200} more</li>}
    </ul>
  )
}

function RuleLimits({ q }: { q: TrackQC }) {
  const r = q.rules
  const items = [
    r.maxCps > 0 && `${r.maxCps} CPS`, r.maxWpm > 0 && `${r.maxWpm} WPM`, `${r.maxChars} chars × ${r.maxLines} lines`,
    `${(r.minDurationMs / 1000).toFixed(2)}–${r.maxDurationMs / 1000} s`, `${r.minGapFrames}-frame gap at ${r.fps} fps`,
    r.shotChangeFrames > 0 && `shot changes ±${r.shotChangeFrames} frames`,
  ].filter(Boolean)
  return <p className="muted small limits">{items.join(' · ')}</p>
}

// ---------- Batch ----------

function Batch({ p, qc }: { p: Project; qc: TrackQC[] }) {
  const cols = RULES.filter(r => qc.some(q => q.issues.some(i => i.rule === r.id)))
  const max = Math.max(1, ...qc.flatMap(q => cols.map(c => q.issues.filter(i => i.rule === c.id).length)))
  const fixAll = async () => {
    let fixed = 0
    const tracks = p.tracks.map(t => {
      const r = qcTrack(p, t).rules
      const out = autoFix(t.cues, r, { lang: t.lang, shots: p.shots }, new Set(t.rejected))
      fixed += out.applied.length
      return out.applied.length ? { ...t, cues: out.cues } : t
    })
    if (!fixed) { toast('Nothing left that auto-fix can change.'); return }
    await updateTracks(p, tracks, `Auto-fix all ${p.tracks.length} tracks`)
    toast(`Applied ${fixed} fixes across ${p.tracks.length} tracks`, { tone: 'ok', undo: async () => { const { getProject } = await import('./store.ts'); const cur = getProject(p.id); if (cur) await undoTracks(cur) } })
  }
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>Language × issue matrix</h2>
          <div className="row gap-sm"><button type="button" className="btn primary sm" onClick={() => void fixAll()}>Auto-fix every track</button><Link href={`/app/p/${p.id}/export`} className="btn ghost sm">Export all</Link></div>
        </div>
        <div className="table-wrap">
          <table className="matrix">
            <thead><tr><th>Track</th><th className="num">Score</th><th className="num">Cues</th>{cols.map(c => <th key={c.id} className="num"><span title={c.desc}>{c.label}</span></th>)}</tr></thead>
            <tbody>
              {qc.map(q => (
                <tr key={q.track.id}>
                  <th><Link href={`/app/p/${p.id}/overview?track=${q.track.id}`}>{langName(q.track.lang)}</Link> <small className="muted">{q.track.role}</small></th>
                  <td className="num"><span className={`score-chip ${scoreClass(q.score)}`}>{q.score}</span></td>
                  <td className="num">{q.track.cues.length}</td>
                  {cols.map(c => {
                    const n = q.issues.filter(i => i.rule === c.id).length
                    const err = q.issues.some(i => i.rule === c.id && i.severity === 'error')
                    return <td key={c.id} className="num cell" style={{ '--h': n / max } as React.CSSProperties} data-err={err || undefined}>{c.needsSource && q.track.role === 'source' ? <span className="muted">n/a</span> : n || <span className="muted">·</span>}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Darker cells have more issues; red cells contain errors. Translation rules only apply to targets, measured against the source track.</p>
      </div>
    </div>
  )
}

// ---------- History ----------

function cueDiff(a: Cue[], b: Cue[]) {
  const A = new Map(a.map(c => [c.id, c])), B = new Map(b.map(c => [c.id, c]))
  const rows: { id: string; kind: 'added' | 'removed' | 'timing' | 'text' | 'both'; a?: Cue; b?: Cue }[] = []
  for (const c of a) {
    const d = B.get(c.id)
    if (!d) rows.push({ id: c.id, kind: 'removed', a: c })
    else {
      const t = c.start !== d.start || c.end !== d.end, x = c.text !== d.text
      if (t || x) rows.push({ id: c.id, kind: t && x ? 'both' : t ? 'timing' : 'text', a: c, b: d })
    }
  }
  for (const d of b) if (!A.has(d.id)) rows.push({ id: d.id, kind: 'added', b: d })
  return rows.sort((x, y) => (x.a ?? x.b)!.start - (y.a ?? y.b)!.start)
}

function History({ p }: { p: Project }) {
  const snaps = [...p.snapshots].sort((a, b) => a.at - b.at)
  const current: Snapshot = useMemo(() => ({ ...snapshotOf(p, 'Current working copy'), id: 'current' }), [p])
  const all = [...snaps, current]
  const [aId, setA] = useState((snaps.length >= 2 ? snaps.at(-2) : snaps.at(-1))?.id ?? 'current')
  const [bId, setB] = useState(snaps.length >= 2 ? snaps.at(-1)!.id : 'current')
  const A = all.find(s => s.id === aId) ?? all[0], B = all.find(s => s.id === bId) ?? current
  const langs = [...new Set([...A.tracks, ...B.tracks].map(t => t.lang + ':' + t.role))]
  const [focus, setFocus] = useState<string | null>(null)
  const fl = focus ?? langs.find(l => l.endsWith(':target')) ?? langs[0]
  const ta = A.tracks.find(t => t.lang + ':' + t.role === fl), tb = B.tracks.find(t => t.lang + ':' + t.role === fl)
  const diff = ta && tb ? cueDiff(ta.cues, tb.cues) : []
  const [label, setLabel] = useState('')

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head"><h2>Delivery snapshots</h2></div>
        <form className="row gap-sm wrap" onSubmit={e => { e.preventDefault(); void saveSnapshot(p, label.trim() || undefined); setLabel('') }}>
          <input aria-label="Snapshot label" placeholder={`v${p.snapshots.length + 1} · e.g. after vendor round 2`} value={label} onChange={e => setLabel(e.target.value)} style={{ maxWidth: 360 }} />
          <button className="btn primary sm">Save snapshot</button>
        </form>
        {snaps.length === 0 ? <p className="muted">No snapshots yet. Save one per delivery version (vendor delivery, after QC, final) to compare them later.</p> : (
          <ul className="snap-list">
            {snaps.map(s => (
              <li key={s.id}>
                <div><b>{s.label}</b> <span className="muted small">{new Date(s.at).toLocaleString()}</span></div>
                <div className="lang-scores">{s.tracks.map(t => <span key={t.id} className={`lang-score ${scoreClass(t.score)}`}><b>{t.lang.toUpperCase()}</b>{t.score}</span>)}</div>
                <div className="row gap-sm">
                  <button type="button" className="btn ghost sm" onClick={async () => {
                    if (!(await ask(`Restore “${s.label}”?`, 'Replaces the cues of matching tracks with this snapshot. You can undo it.', 'Restore', false))) return
                    const tracks = p.tracks.map(t => { const st = s.tracks.find(x => x.id === t.id); return st ? { ...t, cues: st.cues } : t })
                    await updateTracks(p, tracks, `Restore ${s.label}`)
                    toast(`Restored ${s.label}`, { tone: 'ok' })
                  }}>Restore</button>
                  <button type="button" className="btn danger-ghost sm" onClick={async () => {
                    await saveProject({ ...p, snapshots: p.snapshots.filter(x => x.id !== s.id) })
                    void deleteSnapshotCloud(s.id)
                    toast(`Deleted ${s.label}`, { undo: async () => { const { getProject } = await import('./store.ts'); const cur = getProject(p.id); if (cur) await saveProject({ ...cur, snapshots: [...cur.snapshots, s] }) } })
                  }}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Compare</h2>
          <div className="row gap-sm wrap">
            <select aria-label="Compare from" value={A.id} onChange={e => setA(e.target.value)}>{all.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            <span className="muted">&rarr;</span>
            <select aria-label="Compare to" value={B.id} onChange={e => setB(e.target.value)}>{all.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Track</th><th className="num">Score</th><th className="num">Errors</th><th className="num">Warnings</th><th className="num">Cues</th><th>Rules that changed</th></tr></thead>
            <tbody>
              {langs.map(l => {
                const a = A.tracks.find(t => t.lang + ':' + t.role === l), b = B.tracks.find(t => t.lang + ':' + t.role === l)
                const rules = [...new Set([...Object.keys(a?.counts ?? {}), ...Object.keys(b?.counts ?? {})])] as RuleId[]
                const changed = rules.map(r => [r, (b?.counts[r] ?? 0) - (a?.counts[r] ?? 0)] as const).filter(([, d]) => d)
                return (
                  <tr key={l} className={fl === l ? 'sel' : ''} onClick={() => setFocus(l)} style={{ cursor: 'pointer' }}>
                    <th>{langName(l.split(':')[0])} <small className="muted">{l.split(':')[1]}</small></th>
                    <td className="num">{a?.score ?? '—'} &rarr; <b>{b?.score ?? '—'}</b> <Delta v={(b?.score ?? 0) - (a?.score ?? 0)} good="up" /></td>
                    <td className="num">{a?.errors ?? '—'} &rarr; {b?.errors ?? '—'} <Delta v={(b?.errors ?? 0) - (a?.errors ?? 0)} good="down" /></td>
                    <td className="num">{a?.warnings ?? '—'} &rarr; {b?.warnings ?? '—'}</td>
                    <td className="num">{a?.cues.length ?? '—'} &rarr; {b?.cues.length ?? '—'}</td>
                    <td className="small">{changed.length ? changed.map(([r, d]) => <span key={r} className={`delta-tag ${d < 0 ? 'good' : 'bad'}`}>{ruleLabel(r)} {d > 0 ? '+' : ''}{d}</span>) : <span className="muted">none</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <h3 className="mt">{fl ? langName(fl.split(':')[0]) : ''}: {diff.length} changed cue{diff.length === 1 ? '' : 's'}</h3>
        {diff.length === 0 ? <p className="muted small">No cue changes between these versions.</p> : (
          <div className="table-wrap">
            <table className="diff-table">
              <thead><tr><th>Change</th><th>Before</th><th>After</th></tr></thead>
              <tbody>{diff.slice(0, 200).map(d => (
                <tr key={d.id}>
                  <td><span className={`badge ${d.kind === 'removed' ? 'severe' : d.kind === 'added' ? 'low' : 'moderate'}`}>{d.kind}</span></td>
                  <td>{d.a && <><div className="mono tiny muted">{fmtT(d.a.start)} → {fmtT(d.a.end)}</div><div className="pre">{plainText(d.a.text)}</div></>}</td>
                  <td>{d.b && <><div className="mono tiny muted">{fmtT(d.b.start)} → {fmtT(d.b.end)}</div><div className="pre">{plainText(d.b.text)}</div></>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const Delta = ({ v, good }: { v: number; good: 'up' | 'down' }) => !v ? null : <span className={`delta ${(v > 0) === (good === 'up') ? 'good' : 'bad'}`}>{v > 0 ? '+' : ''}{v}</span>

// ---------- Export ----------

export function issuesCsv(qc: TrackQC[]) {
  const esc = (s: string | number) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s)
  const rows = [['language', 'role', 'file', 'cue', 'start', 'end', 'rule', 'severity', 'message', 'text']]
  for (const q of qc) {
    const idx = new Map(q.track.cues.map((c, i) => [c.id, i]))
    for (const i of q.issues) {
      const c = q.track.cues[idx.get(i.cueId)!]
      rows.push([q.track.lang, q.track.role, q.track.fileName, String(idx.get(i.cueId)! + 1), fmtTime(c.start), fmtTime(c.end), i.rule, i.severity, i.message, plainText(c.text).replace(/\n/g, ' / ')])
    }
  }
  return rows.map(r => r.map(esc).join(',')).join('\n') + '\n'
}

export function summaryCsv(qc: TrackQC[]) {
  const rows = [['language', 'role', 'file', 'cues', 'score', ...RULES.map(r => r.id)]]
  for (const q of qc) rows.push([q.track.lang, q.track.role, q.track.fileName, String(q.track.cues.length), String(q.score), ...RULES.map(r => { const s = q.summary.find(x => x.id === r.id); return s ? `${s.pass ? 'pass' : 'fail'} (${s.errors}e/${s.warnings}w)` : 'n/a' })])
  return rows.map(r => r.join(',')).join('\n') + '\n'
}

const baseName = (f: string) => f.replace(/\.[^.]+$/, '')

function Export({ p, qc }: { p: Project; qc: TrackQC[] }) {
  const def = getDefaults().exportFormat
  const [fmt, setFmt] = useState<Record<string, Format>>({})
  const formatOf = (t: Project['tracks'][number]) => fmt[t.id] ?? (def === 'same' ? t.format : def)
  const fileOf = (t: Project['tracks'][number]) => `${baseName(t.fileName)}.qc.${FORMAT_EXT[formatOf(t)]}`
  const textOf = (t: Project['tracks'][number]) => serialize(t.cues, formatOf(t), { lang: t.lang, title: p.name })
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head"><h2>Fixed subtitle files</h2><button type="button" className="btn primary sm" onClick={() => p.tracks.forEach((t, i) => setTimeout(() => download(fileOf(t), textOf(t), 'text/plain;charset=utf-8'), i * 300))}>Download all</button></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Track</th><th>Format</th><th className="num">Cues</th><th className="num">Score</th><th /></tr></thead>
            <tbody>
              {p.tracks.map(t => {
                const q = qc.find(x => x.track.id === t.id)!
                return (
                  <tr key={t.id}>
                    <th>{langName(t.lang)} <small className="muted">{t.fileName}</small></th>
                    <td><select aria-label={`Export format for ${langName(t.lang)}`} value={formatOf(t)} onChange={e => setFmt({ ...fmt, [t.id]: e.target.value as Format })}>{(Object.keys(FORMAT_LABEL) as Format[]).map(f => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}</select></td>
                    <td className="num">{t.cues.length}</td>
                    <td className="num"><span className={`score-chip ${scoreClass(q.score)}`}>{q.score}</span></td>
                    <td><div className="row gap-sm end"><CopyButton text={textOf(t)} /><button type="button" className="btn outline sm" onClick={() => download(fileOf(t), textOf(t), 'text/plain;charset=utf-8')}>Download</button></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Files are written as UTF-8 without a BOM, with cues renumbered and sorted. Italics are kept in every format except SBV, which has none.</p>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h2>QC report</h2>
          <p className="muted">Pass or fail per rule, the score and every issue with its timecode, per track. Print it or save it as PDF for the vendor.</p>
          <div className="row gap-sm wrap">
            <Link href={`/app/p/${p.id}/report`} className="btn primary sm">Open printable report</Link>
            <button type="button" className="btn ghost sm" onClick={() => download(`${baseName(p.name)}-qc-issues.csv`, issuesCsv(qc))}>Issues CSV</button>
            <button type="button" className="btn ghost sm" onClick={() => download(`${baseName(p.name)}-qc-summary.csv`, summaryCsv(qc))}>Summary CSV</button>
          </div>
        </div>
        <div className="panel">
          <h2>Project file</h2>
          <p className="muted">Everything in this project as JSON: tracks, rule edits, shot changes and snapshots. Keep it as an archive or hand it to a colleague.</p>
          <button type="button" className="btn ghost sm" onClick={() => download(`${baseName(p.name)}.caption-qa.json`, JSON.stringify(p, null, 1), 'application/json')}>Download project JSON</button>
        </div>
      </div>
    </div>
  )
}
