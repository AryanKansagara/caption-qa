import { useMemo, useRef, type PointerEvent as RPointerEvent } from 'react'
import type { Issue } from './engine/check.ts'
import type { Cue } from './engine/types.ts'

export interface Lane { key: string; label: string; cues: Cue[]; byCue?: Map<string, Issue[]> }

/** Deterministic speech-like envelope: louder inside cues, quiet in gaps. Used when no real audio is loaded. */
export function synthPeaks(cues: Cue[], duration: number, n = 600): number[] {
  const out: number[] = []
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let i = 0; i < n; i++) {
    const t = (i / n) * duration
    const inCue = cues.some(c => t >= c.start - 60 && t <= c.end - 120)
    const syll = 0.55 + 0.45 * Math.sin(t / 95) * Math.sin(t / 37)
    out.push(inCue ? 0.25 + 0.7 * Math.abs(syll) * (0.6 + 0.4 * rnd()) : 0.04 + 0.05 * rnd())
  }
  return out
}

function Wave({ peaks, from, to, duration }: { peaks: number[]; from: number; to: number; duration: number }) {
  const d = useMemo(() => {
    if (!peaks.length || duration <= 0) return ''
    const i0 = Math.max(0, Math.floor(from / duration * peaks.length)), i1 = Math.min(peaks.length, Math.ceil(to / duration * peaks.length))
    const n = i1 - i0
    if (n <= 1) return ''
    let top = '', bot = ''
    for (let i = 0; i < n; i++) {
      const x = ((i0 + i) / peaks.length * duration - from) / (to - from) * 1000
      const y = peaks[i0 + i] * 46
      top += `${i ? 'L' : 'M'}${x.toFixed(1)} ${(50 - y).toFixed(1)}`
      bot = `L${x.toFixed(1)} ${(50 + y).toFixed(1)}` + bot
    }
    return top + bot + 'Z'
  }, [peaks, from, to, duration])
  return <svg className="tl-wave" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path d={d} /></svg>
}

const fmtTick = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export function Timeline({ lanes, from, to, duration, shots = [], peaks, playhead, selected, onSelect, onSeek, label = 'Subtitle timeline' }: {
  lanes: Lane[]; from: number; to: number; duration: number; shots?: number[]; peaks?: number[]; playhead?: number
  selected?: string | null; onSelect?(laneKey: string, cue: Cue): void; onSeek?(ms: number): void; label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const span = Math.max(1, to - from)
  const pct = (t: number) => `${((t - from) / span) * 100}%`
  const step = span > 120000 ? 30000 : span > 50000 ? 10000 : span > 20000 ? 5000 : span > 8000 ? 2000 : 1000
  const ticks: number[] = []
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t)
  const seek = (e: RPointerEvent) => {
    if (!onSeek || !ref.current || (e.target as HTMLElement).closest('.tl-cue')) return
    const r = ref.current.getBoundingClientRect()
    onSeek(from + ((e.clientX - r.left) / r.width) * span)
  }
  return (
    <div className="tl" role="group" aria-label={label}>
      <div className="tl-body" ref={ref} onPointerDown={seek}>
        <div className="tl-ruler" aria-hidden="true">{ticks.map(t => <span key={t} style={{ left: pct(t) }}>{fmtTick(t)}</span>)}</div>
        {peaks && <Wave peaks={peaks} from={from} to={to} duration={duration} />}
        {shots.filter(s => s >= from && s <= to).map(s => <i key={s} className="tl-shot" style={{ left: pct(s) }} title={`Shot change ${(s / 1000).toFixed(2)} s`} />)}
        {lanes.map((lane, li) => (
          <div key={lane.key} className="tl-lane" style={{ top: `calc(20px + ${li} * (100% - 20px) / ${lanes.length} + 17px)`, height: `calc((100% - 20px) / ${lanes.length} - 22px)` }}>
            <span className="tl-lane-label">{lane.label}</span>
            {lane.cues.filter(c => c.end >= from && c.start <= to).map(c => {
              const iss = lane.byCue?.get(c.id) ?? []
              const sev = iss.some(i => i.severity === 'error') ? 'bad' : iss.length ? 'warn' : 'ok'
              return (
                <button key={c.id} type="button" className={`tl-cue ${sev}${selected === c.id ? ' sel' : ''}`}
                  style={{ left: pct(c.start), width: `${((c.end - c.start) / span) * 100}%` }}
                  title={`${c.text.replace(/<[^>]+>/g, '')}${iss.length ? '\n\n' + iss.map(i => '• ' + i.message).join('\n') : ''}`}
                  aria-label={`Cue at ${(c.start / 1000).toFixed(2)} s${iss.length ? `, ${iss.length} issue${iss.length > 1 ? 's' : ''}` : ''}`}
                  onClick={() => onSelect?.(lane.key, c)}>
                  <span>{c.text.replace(/<[^>]+>/g, '').replace(/\n/g, ' / ')}</span>
                </button>
              )
            })}
          </div>
        ))}
        {playhead !== undefined && playhead >= from && playhead <= to && <i className="tl-head" style={{ left: pct(playhead) }} aria-hidden="true" />}
      </div>
    </div>
  )
}

/** Renders a cue as it would look burned into the picture. */
export function Screen({ cue, children }: { cue?: Cue | null; children?: React.ReactNode }) {
  return (
    <div className="screen">
      {children}
      <div className="screen-sub" aria-live="off">
        {cue && cue.text.split('\n').map((l, i) => <span key={i} dangerouslySetInnerHTML={{ __html: safeLine(l) }} />)}
      </div>
    </div>
  )
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Escapes everything, then re-enables only <i>, <b> and <u>. */
export const safeLine = (l: string) => esc(l).replace(/&lt;(\/?)(i|b|u)&gt;/g, '<$1$2>')
