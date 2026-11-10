import { useEffect, useMemo, useRef, useState } from 'react'
import { align, ruleLabel } from './engine/check.ts'
import { fmtTime, parseClock } from './engine/parse.ts'
import { langName } from './engine/rules.ts'
import { cps, rebreak } from './engine/text.ts'
import type { Cue } from './engine/types.ts'
import { fmtT, plainText, TrackPicker, useTrackParam } from './Project.tsx'
import { replaceTrack, sourceOf, updateTracks, type TrackQC } from './projectData.ts'
import { getProject, saveProject, type Project } from './store.ts'
import { Screen, Timeline } from './Timeline.tsx'
import { isTyping, toast } from './ui.tsx'

// The video stays in this tab's memory only: an object URL, never uploaded or stored.
const media = new Map<string, { url: string; name: string; peaks?: number[]; duration?: number }>()

async function audioPeaks(file: File): Promise<{ peaks: number[]; duration: number }> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ac = new Ctx()
  try {
    const buf = await ac.decodeAudioData(await file.arrayBuffer())
    const ch = buf.getChannelData(0)
    const per = Math.max(1, Math.floor(buf.sampleRate / 50)) // 20 ms buckets
    const n = Math.ceil(ch.length / per)
    const peaks = new Array<number>(n)
    let max = 0
    for (let i = 0; i < n; i++) {
      let m = 0
      for (let k = i * per, e = Math.min(ch.length, k + per); k < e; k += 4) { const v = Math.abs(ch[k]); if (v > m) m = v }
      peaks[i] = m
      if (m > max) max = m
    }
    return { peaks: peaks.map(v => Math.sqrt(v / (max || 1))), duration: buf.duration * 1000 }
  } finally { void ac.close() }
}

const once = (el: HTMLVideoElement, ev: string) => new Promise<void>((res, rej) => {
  const ok = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); res() }
  const bad = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); rej(new Error('The browser could not decode this video.')) }
  el.addEventListener(ev, ok); el.addEventListener('error', bad)
})

/** Frame-difference cut detection on a 64×36 canvas, sampled every 200 ms, then refined by bisection to about one frame. */
async function scanCuts(url: string, onProgress: (k: number) => void, cancelled: () => boolean): Promise<number[]> {
  const v = document.createElement('video')
  v.muted = true; v.preload = 'auto'; v.src = url
  await once(v, 'loadedmetadata')
  const W = 64, H = 36
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  const grab = async (t: number) => { v.currentTime = t; await once(v, 'seeked'); ctx.drawImage(v, 0, 0, W, H); const d = ctx.getImageData(0, 0, W, H).data; const l = new Float32Array(W * H); for (let i = 0; i < l.length; i++) l[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114; return l }
  const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length }
  const step = 0.2, dur = v.duration
  const frames: { t: number; f: Float32Array }[] = []
  for (let t = 0; t < dur; t += step) {
    if (cancelled()) throw new Error('cancelled')
    frames.push({ t, f: await grab(t) })
    onProgress(t / dur)
  }
  const ds = frames.slice(1).map((x, i) => diff(frames[i].f, x.f))
  const mean = ds.reduce((a, b) => a + b, 0) / (ds.length || 1)
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / (ds.length || 1))
  const thr = Math.max(14, mean + 2.5 * sd)
  const cuts: number[] = []
  for (let i = 0; i < ds.length; i++) {
    const local = Math.max(ds[i - 1] ?? 0, ds[i + 1] ?? 0)
    if (ds[i] < thr || ds[i] < local * 1.5) continue
    let lo = frames[i].t, hi = frames[i + 1].t, A = frames[i].f, B = frames[i + 1].f
    for (let k = 0; k < 3; k++) {
      const mid = (lo + hi) / 2, M = await grab(mid)
      if (diff(A, M) > diff(M, B)) { hi = mid; B = M } else { lo = mid; A = M }
    }
    cuts.push(Math.round(hi * 1000))
  }
  v.removeAttribute('src'); v.load()
  return cuts
}

const ZOOMS = [10000, 20000, 60000, 0]

export default function Review({ p, qc }: { p: Project; qc: TrackQC[] }) {
  const [tid, setTid] = useTrackParam(p)
  const q = qc.find(x => x.track.id === tid) ?? qc[0]
  const t = q.track
  const src = t.role === 'target' ? sourceOf(p) : undefined
  const aligned = useMemo(() => src ? align(t.cues, src.cues) : null, [t.cues, src])
  const [sel, setSel] = useState<string | null>(() => new URLSearchParams(location.search).get('cue'))
  const [now, setNow] = useState(0)
  const [zoom, setZoom] = useState(20000)
  const [m, setM] = useState(media.get(p.id))
  const [scan, setScan] = useState<number | null>(null)
  const cancelScan = useRef(false)
  const video = useRef<HTMLVideoElement>(null)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  const selIdx = t.cues.findIndex(c => c.id === sel)
  const selected = selIdx >= 0 ? t.cues[selIdx] : null
  const duration = Math.max(m?.duration ?? 0, (t.cues.at(-1)?.end ?? 0) + 2000, (src?.cues.at(-1)?.end ?? 0) + 2000)
  const span = zoom || duration
  const center = selected && !(video.current && !video.current.paused) ? (selected.start + selected.end) / 2 : now
  const from = zoom ? Math.max(0, Math.min(duration - span, center - span / 2)) : 0
  const live = t.cues.find(c => now >= c.start && now <= c.end) ?? null

  useEffect(() => {
    let raf = 0
    const tick = () => { const v = video.current; if (v && !v.paused) setNow(v.currentTime * 1000); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const select = (c: Cue | undefined, seek = true) => {
    if (!c) return
    setSel(c.id)
    if (seek) { setNow(c.start); if (video.current) video.current.currentTime = c.start / 1000 }
    rowRefs.current.get(c.id)?.scrollIntoView({ block: 'nearest' })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey) return
      if (e.key === ' ' && video.current) { e.preventDefault(); if (video.current.paused) void video.current.play(); else video.current.pause() }
      if (e.key === 'j' || e.key === 'ArrowUp') { e.preventDefault(); select(t.cues[Math.max(0, selIdx - 1)]) }
      if (e.key === 'k' || e.key === 'ArrowDown') { e.preventDefault(); select(t.cues[Math.min(t.cues.length - 1, selIdx + 1)]) }
      if (e.key === 'n') { const n = t.cues.slice(selIdx + 1).find(c => q.byCue.has(c.id)) ?? t.cues.find(c => q.byCue.has(c.id)); select(n) }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const loadVideo = async (f: File) => {
    const old = media.get(p.id)
    if (old) URL.revokeObjectURL(old.url)
    const entry = { url: URL.createObjectURL(f), name: f.name } as NonNullable<typeof m>
    media.set(p.id, entry); setM({ ...entry })
    try {
      const a = await audioPeaks(f)
      Object.assign(entry, a)
      setM({ ...entry })
    } catch { toast('Video loaded. The audio track could not be decoded for a waveform in this browser.', { tone: 'error' }) }
  }

  const runScan = async () => {
    if (!m) return
    cancelScan.current = false
    setScan(0)
    try {
      const cuts = await scanCuts(m.url, k => setScan(k), () => cancelScan.current)
      const cur = getProject(p.id) ?? p
      const old = cur.shots
      await saveProject({ ...cur, shots: cuts })
      toast(`Found ${cuts.length} shot changes`, { tone: 'ok', undo: () => { const c = getProject(p.id); if (c) void saveProject({ ...c, shots: old }) } })
    } catch (e) {
      if (!(e instanceof Error && e.message === 'cancelled')) toast(e instanceof Error ? e.message : String(e), { tone: 'error' })
    } finally { setScan(null) }
  }

  const srcOf = (c: Cue) => aligned?.get(c.id) ?? []
  const lanes = [
    ...(src ? [{ key: 'src', label: `${src.lang.toUpperCase()} source`, cues: src.cues }] : []),
    { key: 'tgt', label: `${t.lang.toUpperCase()} ${t.role}`, cues: t.cues, byCue: q.byCue },
  ]

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <TrackPicker p={p} qc={qc} value={t.id} onChange={v => { setTid(v); setSel(null) }} />
        <div className="row gap-sm wrap">
          <label className="btn outline sm">{m ? 'Replace video' : 'Load local video'}<input type="file" accept="video/*,audio/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void loadVideo(f); e.target.value = '' }} /></label>
          {m && (scan === null
            ? <button type="button" className="btn ghost sm" onClick={() => void runScan()}>Scan for shot changes</button>
            : <button type="button" className="btn ghost sm" onClick={() => { cancelScan.current = true }}>Scanning {Math.round(scan * 100)}% · Cancel</button>)}
        </div>
      </div>

      <div className="review-top">
        <div className="review-video">
          {m ? (
            <div className="screen has-video">
              <video ref={video} src={m.url} onSeeked={e => setNow(e.currentTarget.currentTime * 1000)} onLoadedMetadata={e => { if (m.duration === undefined) setM({ ...m, duration: e.currentTarget.duration * 1000 }) }} controls playsInline aria-label={`Local video ${m.name}`} />
              <div className="screen-sub">{live && live.text.split('\n').map((l, i) => <span key={i}>{plainText(l)}</span>)}</div>
            </div>
          ) : (
            <Screen cue={live ?? selected}>
              <div className="screen-empty"><b>No video loaded</b><span>Load a local file to preview timing against picture and sound. It never leaves this device.</span></div>
            </Screen>
          )}
        </div>
        <CueEditor key={selected?.id ?? 'none'} p={p} q={q} cue={selected} index={selIdx} source={selected ? srcOf(selected) : []} onNav={d => select(t.cues[Math.max(0, Math.min(t.cues.length - 1, selIdx + d))])} />
      </div>

      <div className="panel tl-panel">
        <div className="row between wrap gap-sm">
          <div className="seg-control" role="radiogroup" aria-label="Zoom">
            {ZOOMS.map(z => <button key={z} type="button" role="radio" aria-checked={zoom === z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>{z ? `${z / 1000} s` : 'All'}</button>)}
          </div>
          <span className="muted small">{m?.peaks ? 'Waveform from your video' : 'Load a video for a waveform'} · {p.shots.length} shot changes · <kbd>Space</kbd> play · <kbd>J</kbd>/<kbd>K</kbd> prev/next · <kbd>N</kbd> next issue</span>
        </div>
        <Timeline lanes={lanes} from={from} to={from + span} duration={duration} shots={p.shots} peaks={m?.peaks} playhead={now} selected={sel}
          onSelect={(lane, c) => lane === 'tgt' ? select(c) : (setNow(c.start), video.current && (video.current.currentTime = c.start / 1000))}
          onSeek={ms => { setNow(ms); if (video.current) video.current.currentTime = ms / 1000 }} />
        {zoom > 0 && <input type="range" aria-label="Scroll timeline" min={0} max={Math.max(0, duration - span)} step={100} value={from} onChange={e => { const v = +e.target.value + span / 2; setSel(null); setNow(v); if (video.current) video.current.currentTime = v / 1000 }} />}
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Side by side</h2><span className="muted small">{src ? `${langName(src.lang)} source aligned by time to ${langName(t.lang)}` : 'Select a target track to compare with the source'}</span></div>
        <div className="table-wrap sbs-wrap">
          <table className="sbs">
            <thead><tr><th>#</th><th>Time</th><th className="num">CPS</th>{src && <th>{langName(src.lang)}</th>}<th>{langName(t.lang)}</th><th>Issues</th></tr></thead>
            <tbody>
              {t.cues.map((c, i) => {
                const iss = q.byCue.get(c.id) ?? []
                const v = cps(c.text, c.end - c.start, q.rules.halfWidthLatin)
                return (
                  <tr key={c.id} ref={el => { if (el) rowRefs.current.set(c.id, el); else rowRefs.current.delete(c.id) }} className={`${sel === c.id ? 'sel' : ''} ${iss.some(x => x.severity === 'error') ? 'has-err' : iss.length ? 'has-warn' : ''}`} onClick={() => select(c)}>
                    <td className="mono tiny">{i + 1}</td>
                    <td className="mono tiny nowrap">{fmtT(c.start)}<br />{fmtT(c.end)}</td>
                    <td className={`num tiny ${q.rules.maxCps && v > q.rules.maxCps ? 'error' : 'muted'}`}>{Number.isFinite(v) ? v.toFixed(1) : '—'}</td>
                    {src && <td className="pre muted">{srcOf(c).map(s => plainText(s.text)).join('\n')}</td>}
                    <td className="pre">{plainText(c.text)}</td>
                    <td className="small">{iss.map((x, k) => <span key={k} className={`issue-chip ${x.severity}`} title={x.message}>{ruleLabel(x.rule)}</span>)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CueEditor({ p, q, cue, index, source, onNav }: { p: Project; q: TrackQC; cue: Cue | null; index: number; source: Cue[]; onNav(d: number): void }) {
  const [text, setText] = useState(cue?.text ?? '')
  const [start, setStart] = useState(cue ? fmtTime(cue.start) : '')
  const [end, setEnd] = useState(cue ? fmtTime(cue.end) : '')
  if (!cue) return <div className="panel editor empty-editor"><p className="muted">Select a cue on the timeline or in the table to edit it. Red cues break a rule.</p><p className="muted small"><kbd>N</kbd> jumps to the next cue with an issue.</p></div>
  const t = q.track
  const s = parseClock(start), e = parseClock(end)
  const valid = s !== null && e !== null && e > s
  const dirty = text !== cue.text || s !== cue.start || e !== cue.end
  const v = valid ? cps(text, e! - s!, q.rules.halfWidthLatin) : NaN
  const iss = q.byCue.get(cue.id) ?? []
  const orig = t.original.find(o => o.id === cue.id)
  const save = async () => {
    if (!valid) { toast('Times must be like 00:01:02.345 and end after start.', { tone: 'error' }); return }
    const cues = t.cues.map(c => c.id === cue.id ? { ...c, text: text.replace(/\r/g, '').trim(), start: s!, end: e! } : c).sort((a, b) => a.start - b.start)
    const cur = getProject(p.id) ?? p
    await updateTracks(cur, replaceTrack(cur, { ...t, cues }), `Edit cue #${index + 1}`)
    toast(`Saved cue #${index + 1}`, { tone: 'ok', ttl: 1500 })
  }
  return (
    <div className="panel editor">
      <div className="row between">
        <h2>Cue #{index + 1}</h2>
        <div className="row gap-sm"><button type="button" className="icon-btn" aria-label="Previous cue" onClick={() => onNav(-1)}>&uarr;</button><button type="button" className="icon-btn" aria-label="Next cue" onClick={() => onNav(1)}>&darr;</button></div>
      </div>
      {source.length > 0 && <div className="src-box"><span className="tiny muted">{q.track.role === 'target' ? 'Source' : ''}</span><div className="pre">{source.map(x => plainText(x.text)).join('\n')}</div></div>}
      <div className="pair">
        <label className="field"><span>In</span><input className="mono" value={start} onChange={x => setStart(x.target.value)} /></label>
        <label className="field"><span>Out</span><input className="mono" value={end} onChange={x => setEnd(x.target.value)} /></label>
      </div>
      <label className="field"><span>Text <small className="muted">({valid ? `${((e! - s!) / 1000).toFixed(2)} s · ` : ''}<b className={q.rules.maxCps && v > q.rules.maxCps ? 'error' : ''}>{Number.isFinite(v) ? v.toFixed(1) : '—'} CPS</b>{q.rules.maxCps ? ` / ${q.rules.maxCps}` : ''})</small></span>
        <textarea rows={3} value={text} onChange={x => setText(x.target.value)} onKeyDown={x => { if ((x.metaKey || x.ctrlKey) && x.key === 'Enter') void save() }} />
      </label>
      {iss.length > 0 && <ul className="editor-issues">{iss.map((x, k) => <li key={k} className={x.severity}><b>{ruleLabel(x.rule)}</b> {x.message}</li>)}</ul>}
      <div className="row gap-sm wrap">
        <button type="button" className="btn primary sm" disabled={!dirty || !valid} onClick={() => void save()} title="Ctrl/Cmd + Enter">Save</button>
        <button type="button" className="btn ghost sm" onClick={() => setText(rebreak(text, q.rules.maxChars, t.lang, q.rules.halfWidthLatin))}>Re-break</button>
        {orig && (orig.text !== cue.text || orig.start !== cue.start || orig.end !== cue.end) && <button type="button" className="btn ghost sm" onClick={() => { setText(orig.text); setStart(fmtTime(orig.start)); setEnd(fmtTime(orig.end)) }}>As delivered</button>}
      </div>
    </div>
  )
}

