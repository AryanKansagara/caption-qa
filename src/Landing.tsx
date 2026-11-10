import { useEffect, useMemo, useRef, useState } from 'react'
import { check, ruleLabel, score } from './engine/check.ts'
import { applyChange, autoFix, FIX_LABEL, type Change } from './engine/fix.ts'
import { parse } from './engine/parse.ts'
import { PROFILES, rulesFor } from './engine/rules.ts'
import { SAMPLE_FILES, SAMPLE_SHOTS } from './engine/sample.ts'
import { cps } from './engine/text.ts'
import type { Cue } from './engine/types.ts'
import { Screen, synthPeaks, Timeline } from './Timeline.tsx'
import { Link } from './ui.tsx'

const SRC = parse(SAMPLE_FILES[0].text).cues
const DE = parse(SAMPLE_FILES[2].text, null, SAMPLE_FILES[2].name).cues
const RULES = rulesFor(PROFILES[0], 'de')
const CTX = { lang: 'de', shots: SAMPLE_SHOTS, source: SRC }
const DURATION = Math.ceil((DE.at(-1)!.end + 1500) / 1000) * 1000
const PEAKS = synthPeaks(SRC, DURATION, 700)
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function useCountUp(target: number) {
  const [v, setV] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    if (reduced()) { cur.current = target; setV(target); return }
    let raf = 0
    const from = cur.current, t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 500)
      cur.current = Math.round(from + (target - from) * (1 - (1 - k) ** 3))
      setV(cur.current)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

function Hero() {
  const [cues, setCues] = useState<Cue[]>(DE)
  const [last, setLast] = useState<Change | null>(null)
  const [fixing, setFixing] = useState(false)
  const [done, setDone] = useState(false)
  const [t, setT] = useState(SRC[0].start + 400)
  const [sel, setSel] = useState<string | null>(null)
  const issues = useMemo(() => check(cues, RULES, CTX), [cues])
  const byCue = useMemo(() => { const m = new Map<string, typeof issues>(); for (const i of issues) m.set(i.cueId, [...(m.get(i.cueId) ?? []), i]); return m }, [issues])
  const s = useCountUp(score(cues, issues))
  const errors = issues.filter(i => i.severity === 'error').length
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Playhead loops through the sample at 1.5x so the preview shows each cue as a viewer would.
  useEffect(() => {
    if (reduced()) return
    let raf = 0, prev = performance.now()
    const tick = (now: number) => {
      setT(x => { const n = x + (now - prev) * 1.5; return n > DURATION ? 0 : n })
      prev = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const runFix = () => {
    const { applied } = autoFix(DE, RULES, CTX)
    setCues(DE); setFixing(true); setDone(false)
    let cur = DE, i = 0
    const step = () => {
      if (i >= applied.length) { setFixing(false); setDone(true); setLast(null); return }
      const nx = applyChange(cur, applied[i])
      if (nx) { cur = nx; setCues(nx); setLast(applied[i]) }
      i++
      timer.current = setTimeout(step, reduced() ? 0 : 170)
    }
    step()
  }
  const reset = () => { clearTimeout(timer.current); setCues(DE); setFixing(false); setDone(false); setLast(null) }

  const focus = cues.find(c => c.id === sel) ?? cues.find(c => t >= c.start && t <= c.end) ?? null
  const focusIssues = focus ? byCue.get(focus.id) ?? [] : []
  const srcCue = focus ? SRC.find(c => c.start < focus.end && c.end > focus.start) : null

  return (
    <div className="hero-demo" aria-label="Live demo: QC and auto-fix of a German subtitle track">
      <div className="demo-top">
        <Screen cue={focus}>
          <div className="screen-meta">
            <span className="chip-dark">DE · 24 fps · Netflix-style</span>
            {focus && <span className={`chip-dark ${cps(focus.text, focus.end - focus.start) > RULES.maxCps ? 'hot' : 'cool'}`}>{cps(focus.text, focus.end - focus.start).toFixed(1)} CPS / {RULES.maxCps}</span>}
          </div>
          {srcCue && <div className="screen-src">EN: {srcCue.text.replace(/<[^>]+>/g, '').replace(/\n/g, ' ')}</div>}
        </Screen>
        <div className="demo-score">
          <div className={`score-ring${s >= 60 ? ' good' : s >= 30 ? ' mid' : ''}`} style={{ '--p': s } as React.CSSProperties}>
            <b>{s}</b><span>QC score</span>
          </div>
          <dl>
            <div><dt>Errors</dt><dd className={errors ? 'error' : 'good-text'}>{errors}</dd></div>
            <div><dt>Warnings</dt><dd>{issues.length - errors}</dd></div>
          </dl>
          <div className="demo-actions">
            {!done ? <button type="button" className="btn primary" disabled={fixing} onClick={runFix}>{fixing ? 'Fixing' : 'Auto-fix'}</button> : <button type="button" className="btn outline" onClick={reset}>Reset</button>}
          </div>
        </div>
      </div>
      <Timeline lanes={[{ key: 'en', label: 'EN source', cues: SRC }, { key: 'de', label: 'DE target', cues, byCue }]} from={0} to={DURATION} duration={DURATION} shots={SAMPLE_SHOTS} peaks={PEAKS} playhead={t}
        selected={focus?.id} onSelect={(lane, c) => { if (lane === 'de') setSel(c.id === sel ? null : c.id) }} onSeek={ms => { setSel(null); setT(ms) }} label="German subtitle timeline with violations" />
      <div className="demo-foot" aria-live="polite">
        {last ? <span><b>{FIX_LABEL[last.kind]}</b> {last.note}</span>
          : focusIssues.length ? <span><b className="error">{ruleLabel(focusIssues[0].rule)}</b> {focusIssues[0].message}{focusIssues.length > 1 ? ` (+${focusIssues.length - 1} more)` : ''}</span>
          : done ? <span><b>Done.</b> Overlaps, gaps, breaks and shot changes are fixed. What is left is reading speed: German runs about 31% longer than the English and needs condensing by a person.</span>
          : <span className="muted">Synthetic sample. Red cues break a rule. Click one to see why, or press Auto-fix.</span>}
      </div>
    </div>
  )
}

const FEATURES: [string, string][] = [
  ['Every format, every encoding', 'SRT, WebVTT, ASS/SSA, TTML/DFXP and SBV. UTF-8, UTF-16 and Windows-1252 with BOM handling, and a validation report that points at the line.'],
  ['Rules from real style guides', 'Dated Netflix-style presets per language (20 CPS English, 17 for most European languages, 13 full-width characters for Japanese), BBC words-per-minute, a social preset, or your own.'],
  ['Translation checks', 'Source and target aligned by time: expansion ratio per line, untranslated lines, numbers and names that went missing.'],
  ['Auto-fix you can review', 'Retiming into gaps, borrowing from neighbours, merges, splits, re-breaking, shot-change snapping. Accept or reject each change, with undo.'],
  ['Sync repair', 'Shift, two-point linear resync for drifting files, and 23.976 to 25 fps conversion for PAL masters.'],
  ['Video, waveform, shot changes', 'Drop a local video for preview and an audio waveform. Import a shot list or scan the picture for cuts in the browser. Nothing is uploaded.'],
  ['Batch by language', 'Load every target language at once and see a language by issue matrix before anything ships.'],
  ['Deliverables', 'Fixed files in any supported format, a printable QC report with pass/fail per rule, CSV, and snapshots per delivery version.'],
]

export function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="eyebrow">Subtitle and caption QC</div>
            <h1>Ship subtitles in every language <span className="grad">without the red flags</span></h1>
            <p className="lede">Caption QA checks reading speed, line length, timing and translation against real style guides, fixes what a machine can fix, and shows you the rest side by side with the source.</p>
            <div className="row gap wrap">
              <Link href="/app?sample=1" className="btn primary lg">Try the sample</Link>
              <Link href="/app" className="btn outline lg">Import your files</Link>
            </div>
            <p className="muted small">Free. Runs in your browser. No account needed.</p>
          </div>
          <Hero />
        </div>
      </section>

      <section className="band">
        <div className="page">
          <div className="evidence">
            <figure><b>18%</b><figcaption>faster than Netflix&rsquo;s reading-speed limit: what word-for-word subtitles averaged across 10,165 English videos in one community analysis.</figcaption></figure>
            <figure><b>Real time</b><figcaption>is how many editors still check subtitle timing, by watching the whole cut at normal playback.</figcaption></figure>
            <figure><b>.ass &rarr; .srt</b><figcaption>conversions that leave overlapping end times, and translations that drift off the original timecodes.</figcaption></figure>
          </div>
        </div>
      </section>

      <section className="page">
        <div className="section-head">
          <div className="eyebrow">What it does</div>
          <h2>The QC pass your vendor should have run</h2>
          <p className="muted">Built for video producers, localisation managers and freelance subtitlers delivering SRT and VTT in many languages.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map(([h, p], i) => <article key={h} className="feature" style={{ '--i': i } as React.CSSProperties}><h3>{h}</h3><p>{p}</p></article>)}
        </div>
      </section>

      <section className="page">
        <div className="steps">
          <div><span>1</span><h3>Drop the files</h3><p>Source plus every translation. Format, encoding and language are detected; problems are listed by line.</p></div>
          <div><span>2</span><h3>Pick the rules</h3><p>Choose a dated preset per platform, switch to children&rsquo;s reading speeds, or edit your own profile.</p></div>
          <div><span>3</span><h3>Fix and review</h3><p>Run auto-fix, accept or reject each change, then condense what still reads too fast.</p></div>
          <div><span>4</span><h3>Deliver</h3><p>Export fixed files and a QC report, and keep a snapshot of each delivery version.</p></div>
        </div>
        <div className="cta">
          <h2>See it on the sample in under a minute</h2>
          <p className="muted">An English source with Spanish and German translations, written for this tool, with the problems real deliveries have.</p>
          <div className="row gap center-x wrap"><Link href="/app?sample=1" className="btn primary lg">Open the sample</Link><Link href="/docs" className="btn outline lg">Read the docs</Link></div>
        </div>
      </section>
    </>
  )
}
