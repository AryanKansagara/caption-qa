import { useMemo, useState } from 'react'
import { ruleLabel } from './engine/check.ts'
import { applyChange, autoFix, convertFps, FIX_LABEL, FPS, propose, resync, shift, type Change, type FixKind } from './engine/fix.ts'
import { parseClock } from './engine/parse.ts'
import { langName } from './engine/rules.ts'
import { fmtT, plainText, ScoreRing, TrackPicker, useTrackParam } from './Project.tsx'
import { qcTrack, replaceTrack, undoDepth, undoTracks, updateTracks, type TrackQC } from './projectData.ts'
import { getProject, type Project, type Track } from './store.ts'
import { Empty, Link, toast } from './ui.tsx'

const undoLatest = (id: string) => async () => { const cur = getProject(id); if (cur) await undoTracks(cur) }

export default function Fixes({ p, qc }: { p: Project; qc: TrackQC[] }) {
  const [tid, setTid] = useTrackParam(p)
  const q = qc.find(x => x.track.id === tid) ?? qc[0]
  const t = q.track
  const rejected = useMemo(() => new Set(t.rejected), [t.rejected])
  const changes = useMemo(() => propose(t.cues, q.rules, { lang: t.lang, shots: p.shots }, rejected), [t.cues, q.rules, p.shots, rejected, t.lang])
  const [kind, setKind] = useState<FixKind | 'all'>('all')
  const shown = changes.filter(c => kind === 'all' || c.kind === kind)
  const kinds = [...new Set(changes.map(c => c.kind))]
  const preview = useMemo(() => {
    const out = autoFix(t.cues, q.rules, { lang: t.lang, shots: p.shots }, rejected)
    return { n: out.applied.length, score: qcTrack(p, { ...t, cues: out.cues }).score, cues: out.cues }
  }, [t, q.rules, p, rejected])
  const idx = useMemo(() => new Map(t.cues.map((c, i) => [c.id, i + 1])), [t.cues])
  const unfixable = q.issues.filter(i => ['cps', 'wpm', 'untranslated', 'numbers', 'names', 'expansion', 'chars', 'tags'].includes(i.rule) && !changes.some(c => c.before.some(b => b.id === i.cueId)))

  const save = (track: Track, label: string) => updateTracks(p, replaceTrack(p, track), label)
  const accept = async (ch: Change) => {
    const next = applyChange(t.cues, ch)
    if (!next) { toast('That change is out of date; the list has been refreshed.'); return }
    await save({ ...t, cues: next }, `${FIX_LABEL[ch.kind]} at #${idx.get(ch.before[0].id)}`)
  }
  const reject = (ch: Change) => save({ ...t, rejected: [...t.rejected, ch.key] }, `Reject ${FIX_LABEL[ch.kind].toLowerCase()}`)
  const acceptAll = async () => {
    if (!preview.n) return
    await save({ ...t, cues: preview.cues }, `Auto-fix ${langName(t.lang)} (${preview.n} changes)`)
    toast(`Applied ${preview.n} fixes to ${langName(t.lang)}. Score ${q.score} → ${preview.score}.`, { tone: 'ok', undo: () => void undoLatest(p.id)() })
  }

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <TrackPicker p={p} qc={qc} value={t.id} onChange={setTid} />
        <div className="row gap-sm wrap">
          <button type="button" className="btn ghost sm" disabled={!undoDepth(p.id)} onClick={() => void undoLatest(p.id)()}>Undo last</button>
          {t.rejected.length > 0 && <button type="button" className="btn ghost sm" onClick={() => void save({ ...t, rejected: [] }, 'Clear rejected fixes')}>Reconsider {t.rejected.length} rejected</button>}
        </div>
      </div>

      <div className="fix-hero panel tint">
        <ScoreRing score={q.score} />
        <div className="grow">
          <h2>{changes.length ? `${changes.length} fixes proposed for ${langName(t.lang)}` : `Nothing left to auto-fix in ${langName(t.lang)}`}</h2>
          <p className="muted">{preview.n ? <>Accepting everything applies {preview.n} changes in rounds (later fixes use the room earlier ones make) and moves the score from <b>{q.score}</b> to <b>{preview.score}</b>.</> : 'Remaining issues need a person: condense text, check translations, fix tags.'}</p>
        </div>
        <button type="button" className="btn primary" disabled={!preview.n} onClick={() => void acceptAll()}>Accept all</button>
      </div>

      {changes.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Review each change</h2>
            <div className="seg-control" role="radiogroup" aria-label="Fix type">
              <button type="button" role="radio" aria-checked={kind === 'all'} className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>All {changes.length}</button>
              {kinds.map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{FIX_LABEL[k]} {changes.filter(c => c.kind === k).length}</button>)}
            </div>
          </div>
          <ul className="change-list">
            {shown.slice(0, 150).map(ch => (
              <li key={ch.key}>
                <div className="change-head">
                  <span className={`badge fix-${ch.kind}`}>{FIX_LABEL[ch.kind]}</span>
                  <span className="mono small">#{ch.before.map(b => idx.get(b.id)).join('–')}</span>
                  <span className="muted small grow">{ch.note}</span>
                  <button type="button" className="btn ghost sm" onClick={() => void reject(ch)}>Reject</button>
                  <button type="button" className="btn outline sm" onClick={() => void accept(ch)}>Accept</button>
                </div>
                <div className="change-body">
                  <CueStack cues={ch.before} other={ch.after} side="before" />
                  <span className="arrow" aria-hidden="true">&rarr;</span>
                  <CueStack cues={ch.after} other={ch.before} side="after" />
                </div>
              </li>
            ))}
          </ul>
          {shown.length > 150 && <p className="muted small">Showing 150 of {shown.length}. Accept all, or filter by type.</p>}
        </div>
      )}

      {unfixable.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Needs a person ({unfixable.length})</h2><Link href={`/app/p/${p.id}/review?track=${t.id}`} className="btn ghost sm">Open review</Link></div>
          <p className="muted small">Retiming cannot buy enough time for these, or the problem is in the words. Condense, correct or confirm them in Review.</p>
          <ul className="issue-list compact">
            {unfixable.slice(0, 60).map((i, k) => <li key={k} className={i.severity}><Link className="issue-time mono" href={`/app/p/${p.id}/review?track=${t.id}&cue=${i.cueId}`}>#{idx.get(i.cueId)}</Link><div><b>{ruleLabel(i.rule)}</b> <span className="muted">{i.message}</span></div></li>)}
          </ul>
        </div>
      )}

      <SyncTools p={p} t={t} save={save} />
    </div>
  )
}

function CueStack({ cues, other, side }: { cues: Change['before']; other: Change['before']; side: 'before' | 'after' }) {
  return (
    <div className={`cue-stack ${side}`}>
      {cues.map((c, i) => {
        const o = other.find(x => x.id === c.id) ?? other[i]
        const timeChanged = !o || o.start !== c.start || o.end !== c.end
        return (
          <div key={c.id + i} className="mini-cue">
            <div className={`mono tiny${timeChanged ? ' changed' : ' muted'}`}>{fmtT(c.start)} → {fmtT(c.end)} <span className="muted">({((c.end - c.start) / 1000).toFixed(2)} s)</span></div>
            <div className={`pre${o && o.text !== c.text ? ' changed' : ''}`}>{plainText(c.text)}</div>
          </div>
        )
      })}
    </div>
  )
}

function SyncTools({ p, t, save }: { p: Project; t: Track; save(t: Track, label: string): Promise<unknown> }) {
  const [ms, setMs] = useState('')
  const [pts, setPts] = useState({ a1: '', b1: '', a2: '', b2: '' })
  const [all, setAll] = useState(false)
  const run = async (f: (c: Track['cues']) => Track['cues'], label: string) => {
    try {
      if (all) await updateTracks(p, p.tracks.map(x => ({ ...x, cues: f(x.cues) })), `${label} (all tracks)`)
      else await save({ ...t, cues: f(t.cues) }, label)
      toast(`${label} applied${all ? ' to every track' : ''}`, { tone: 'ok', undo: () => void undoLatest(p.id)() })
    } catch (e) { toast(e instanceof Error ? e.message : String(e), { tone: 'error' }) }
  }
  const time = (s: string) => { const v = s.trim(); if (!v) return null; return /^-?\d+(\.\d+)?$/.test(v) ? Math.round(+v * 1000) : parseClock(v) }
  const first = t.cues[0], last = t.cues.at(-1)
  return (
    <div className="panel">
      <div className="panel-head"><h2>Sync tools</h2><label className="row gap-sm small"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Apply to every track</label></div>
      <div className="grid-3 sync-grid">
        <form onSubmit={e => { e.preventDefault(); const v = Number(ms); if (Number.isFinite(v) && v) void run(c => shift(c, v), `Shift ${v > 0 ? '+' : ''}${v} ms`) }}>
          <h3>Shift</h3>
          <p className="muted small">Move every cue earlier (negative) or later.</p>
          <label className="field"><span>Offset in ms</span><input type="number" step="1" value={ms} onChange={e => setMs(e.target.value)} placeholder="-1200" /></label>
          <button className="btn outline sm" disabled={!Number(ms)}>Shift</button>
        </form>
        <form onSubmit={e => {
          e.preventDefault()
          const [a1, b1, a2, b2] = [time(pts.a1), time(pts.b1), time(pts.a2), time(pts.b2)]
          if ([a1, b1, a2, b2].some(v => v === null)) { toast('Enter all four times as seconds or 00:00:00.000.', { tone: 'error' }); return }
          void run(c => resync(c, a1!, b1!, a2!, b2!), 'Two-point resync')
        }}>
          <h3>Two-point resync</h3>
          <p className="muted small">For drift: give the current and correct time of an early and a late line. Everything is stretched linearly.</p>
          <div className="pair"><label className="field"><span>Early: now</span><input value={pts.a1} onChange={e => setPts({ ...pts, a1: e.target.value })} placeholder={first ? (first.start / 1000).toFixed(3) : ''} /></label><label className="field"><span>should be</span><input value={pts.b1} onChange={e => setPts({ ...pts, b1: e.target.value })} /></label></div>
          <div className="pair"><label className="field"><span>Late: now</span><input value={pts.a2} onChange={e => setPts({ ...pts, a2: e.target.value })} placeholder={last ? (last.start / 1000).toFixed(3) : ''} /></label><label className="field"><span>should be</span><input value={pts.b2} onChange={e => setPts({ ...pts, b2: e.target.value })} /></label></div>
          <button className="btn outline sm">Resync</button>
        </form>
        <div>
          <h3>Frame-rate conversion</h3>
          <p className="muted small">For speed-changed masters. 23.976 film on a 25 fps PAL master runs 4.27% faster, so every time scales by 0.959.</p>
          <div className="row gap-sm wrap">
            <button type="button" className="btn outline sm" onClick={() => void run(c => convertFps(c, FPS.film, FPS.pal), '23.976 → 25 fps')}>23.976 → 25</button>
            <button type="button" className="btn outline sm" onClick={() => void run(c => convertFps(c, FPS.pal, FPS.film), '25 → 23.976 fps')}>25 → 23.976</button>
          </div>
        </div>
      </div>
    </div>
  )
}
