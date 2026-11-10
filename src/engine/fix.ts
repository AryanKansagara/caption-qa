import { frameMs, type Rules } from './rules.ts'
import { lineChars, plain, rebreak, textChars, wordCount } from './text.ts'
import type { Cue } from './types.ts'

export type FixKind = 'overlap' | 'gap' | 'split' | 'rebreak' | 'snap' | 'chain' | 'extend' | 'merge'
export const FIX_LABEL: Record<FixKind, string> = { overlap: 'Fix overlap', gap: 'Restore minimum gap', split: 'Split long cue', rebreak: 'Re-break lines', snap: 'Snap to shot change', chain: 'Close short gap', extend: 'Extend for reading speed', merge: 'Merge flashing cue' }
const ORDER: FixKind[] = ['overlap', 'gap', 'split', 'rebreak', 'snap', 'chain', 'extend', 'merge']

export interface Change {
  key: string
  kind: FixKind
  note: string
  before: Cue[]
  after: Cue[]
}

export interface FixContext { lang: string; shots?: number[] }

const round = (n: number) => Math.round(n)

/** Display time a cue needs: the minimum duration, the reading-speed time and the per-word time, whichever is longest. */
export function needMs(c: Cue, r: Rules, lang: string) {
  const words = wordCount(c.text, lang)
  return Math.min(r.maxDurationMs, Math.max(
    r.minDurationMs,
    r.maxCps > 0 ? textChars(c.text, r.halfWidthLatin) / r.maxCps * 1000 : 0,
    r.maxWpm > 0 ? words / r.maxWpm * 60000 : 0,
    r.minMsPerWord * words,
  ))
}

const fits = (text: string, r: Rules) => { const l = text.split('\n'); return l.length <= r.maxLines && l.every(x => lineChars(x, r.halfWidthLatin) <= r.maxChars) }

function splitText(text: string): [string, string] | null {
  const flat = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
  const mid = flat.length / 2
  let best = -1, bestD = Infinity
  // Prefer sentence ends, then commas, then any space; closest to the middle wins within each tier.
  for (const re of [/[.!?…]\s/g, /[,;:]\s/g, /\s/g]) {
    for (const m of flat.matchAll(re)) {
      const at = m.index! + m[0].length - 1
      const d = Math.abs(at - mid)
      if (d < bestD && at > 3 && at < flat.length - 3) { bestD = d; best = at }
    }
    if (best >= 0 && bestD < flat.length * 0.3) break
  }
  if (best < 0) return null
  return [flat.slice(0, best).trim(), flat.slice(best).trim()]
}

export function propose(cues: Cue[], r: Rules, ctx: FixContext, rejected: Set<string> = new Set()): Change[] {
  const f = frameMs(r)
  const minGap = r.minGapFrames * f
  const shots = ctx.shots ?? []
  const out: Change[] = []
  const push = (kind: FixKind, note: string, before: Cue[], after: Cue[]) => {
    const key = `${kind}:${before.map(c => c.id).join('+')}`
    if (rejected.has(key)) return
    if (after.length === before.length && after.every((a, i) => a.start === before[i].start && a.end === before[i].end && a.text === before[i].text)) return
    out.push({ key, kind, note, before, after })
  }

  cues.forEach((c, i) => {
    const prev = cues[i - 1], next = cues[i + 1]
    const need = needMs(c, r, ctx.lang)

    // Overlaps (the classic broken .ass conversion): trim the earlier cue, or push this one later if trimming would flash.
    if (prev && c.start < prev.end) {
      const trimmed = c.start - minGap
      if (trimmed - prev.start >= r.minDurationMs) push('overlap', `End the previous cue ${r.minGapFrames} frames before this one starts.`, [prev, c], [{ ...prev, end: round(trimmed) }, c])
      else {
        const ns = prev.end + minGap
        push('overlap', 'Start this cue after the previous one ends.', [prev, c], [prev, { ...c, start: round(ns), end: Math.max(c.end, round(ns + r.minDurationMs)) }])
      }
      return
    }
    if (prev && c.start - prev.end < minGap - 1) {
      push('gap', `Leave ${r.minGapFrames} frames between cues.`, [prev], [{ ...prev, end: round(c.start - minGap) }])
    }

    const flat = plain(c.text)
    const dur = c.end - c.start
    if (dur > r.maxDurationMs + 1 || !fits(rebreak(c.text, r.maxChars, ctx.lang, r.halfWidthLatin), r) && flat.includes(' ')) {
      const parts = splitText(c.text)
      if (parts) {
        const [a, b] = parts
        const at = c.start + dur * (a.length / (a.length + b.length))
        push('split', 'Split into two cues at the most natural break, timed by length.', [c], [
          { id: c.id, start: c.start, end: round(at - minGap / 2), text: rebreak(a, r.maxChars, ctx.lang, r.halfWidthLatin) },
          { id: freshId(cues, c.id), start: round(at + minGap / 2), end: c.end, text: rebreak(b, r.maxChars, ctx.lang, r.halfWidthLatin) },
        ])
        return
      }
    }

    const rb = rebreak(c.text, r.maxChars, ctx.lang, r.halfWidthLatin)
    if (rb !== c.text && fits(rb, r)) push('rebreak', rb.includes('\n') ? 'Balance the two lines and keep short words with their nouns.' : 'Fits on one line.', [c], [{ ...c, text: rb }])

    if (r.shotChangeFrames > 0 && shots.length) {
      const w = r.shotChangeFrames * f
      const sIn = shots.find(s => Math.abs(c.start - s) > f / 2 && Math.abs(c.start - s) < w)
      const prevOk = sIn !== undefined && (!prev || prev.end <= sIn - minGap || sIn - minGap - prev.start >= r.minDurationMs)
      if (sIn !== undefined && prevOk && c.end - sIn >= r.minDurationMs) {
        const note = `Move the in-time to the shot change at ${(sIn / 1000).toFixed(2)} s.`
        if (prev && prev.end > sIn - minGap) push('snap', note + ` The previous cue now ends ${r.minGapFrames} frames before the cut.`, [prev, c], [{ ...prev, end: round(sIn - minGap) }, { ...c, start: round(sIn) }])
        else push('snap', note, [c], [{ ...c, start: round(sIn) }])
      } else {
        const sOut = shots.find(s => Math.abs(c.end - (s - minGap)) > f / 2 && Math.abs(c.end - s) < w && s > c.start + r.minDurationMs)
        if (sOut !== undefined) {
          const ne = round(sOut - minGap)
          const ok = ne > c.end ? (!next || next.start >= sOut) : ne - c.start >= need - f
          if (ok) push('snap', `End ${r.minGapFrames} frames before the shot change at ${(sOut / 1000).toFixed(2)} s.`, [c], [{ ...c, end: ne }])
        }
      }
    }

    if (next && r.closeGapFrames > 0) {
      const gap = next.start - c.end
      if (gap > minGap + 1 && gap < r.closeGapFrames * f - 1) push('chain', `Close the ${Math.round(gap / f)}-frame gap to ${r.minGapFrames} frames.`, [c], [{ ...c, end: round(next.start - minGap) }])
    }

    if (dur < need - 1) {
      const nextShot = shots.find(s => s > c.end + f)
      let limit = Math.min(next ? next.start - minGap : Infinity, c.start + r.maxDurationMs)
      if (nextShot !== undefined && nextShot - minGap >= c.start + need) limit = Math.min(limit, nextShot - minGap)
      let end = Math.max(c.end, Math.min(c.start + need, limit))
      let start = c.start
      if (end - start < need - 1) start = Math.min(start, Math.max(prev ? prev.end + minGap : 0, end - need))
      end = round(end); start = round(start)
      // Still short and chained to the next cue: borrow time from the next cue if it has more than it needs.
      if (end - start < need - 1 && next && next.start - minGap - end < f) {
        const slack = next.end - next.start - needMs(next, r, ctx.lang)
        const take = Math.min(slack, need - (end - start), c.start + r.maxDurationMs - end)
        if (take > f) {
          const ne = round(end + take)
          push('extend', `Extend to ${((ne - start) / 1000).toFixed(2)} s by starting the next cue ${Math.round(take)} ms later (it has time to spare).`, [c, next], [{ ...c, start, end: ne }, { ...next, start: round(ne + minGap) }])
          return
        }
      }
      if (end - start > dur + f / 2) {
        push('extend', `Extend from ${(dur / 1000).toFixed(2)} s to ${((end - start) / 1000).toFixed(2)} s (needs ${(need / 1000).toFixed(2)} s).`, [c], [{ ...c, start, end }])
      } else if (dur < r.minDurationMs && next && next.start - c.end < 1000) {
        const text = rebreak(`${c.text} ${next.text}`, r.maxChars, ctx.lang, r.halfWidthLatin)
        if (fits(text, r) && next.end - c.start <= r.maxDurationMs) push('merge', 'Merge with the next cue; there is no room to extend it.', [c, next], [{ ...c, end: next.end, text }])
      }
    }
  })
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.before[0].start - b.before[0].start)
}

/** Applies a change if the cues it was computed from are unchanged. Returns null when stale. */
export function applyChange(cues: Cue[], ch: Change): Cue[] | null {
  const i = cues.findIndex(c => c.id === ch.before[0].id)
  if (i < 0) return null
  for (let k = 0; k < ch.before.length; k++) {
    const a = cues[i + k], b = ch.before[k]
    if (!a || a.id !== b.id || a.start !== b.start || a.end !== b.end || a.text !== b.text) return null
  }
  const next = [...cues.slice(0, i), ...ch.after, ...cues.slice(i + ch.before.length)]
  return next.sort((a, b) => a.start - b.start)
}

/** Applies every non-rejected fix, round by round, until nothing changes. */
export function autoFix(cues: Cue[], r: Rules, ctx: FixContext, rejected: Set<string> = new Set()): { cues: Cue[]; applied: Change[] } {
  let cur = cues
  const applied: Change[] = []
  for (let round = 0; round < 8; round++) {
    const props = propose(cur, r, ctx, rejected)
    if (!props.length) break
    const touched = new Set<string>()
    let changed = false
    for (const ch of props) {
      if (ch.before.some(c => touched.has(c.id))) continue
      const nx = applyChange(cur, ch)
      if (!nx) continue
      cur = nx
      ch.before.forEach(c => touched.add(c.id))
      // Neighbours shift too, so do not touch them again this round.
      const i = cur.findIndex(c => c.id === ch.after[0].id)
      if (cur[i - 1]) touched.add(cur[i - 1].id)
      if (cur[i + ch.after.length]) touched.add(cur[i + ch.after.length].id)
      applied.push(ch)
      changed = true
    }
    if (!changed) break
  }
  return { cues: uniqueIds(cur), applied }
}

function freshId(cues: Cue[], base: string) {
  let id = `${base}s`
  while (cues.some(c => c.id === id)) id += 's'
  return id
}

function uniqueIds(cues: Cue[]) {
  const seen = new Set<string>()
  return cues.map(c => { let id = c.id; while (seen.has(id)) id += 's'; seen.add(id); return id === c.id ? c : { ...c, id } })
}

// ---------- Sync tools ----------

export const shift = (cues: Cue[], ms: number): Cue[] => cues.map(c => ({ ...c, start: Math.max(0, round(c.start + ms)), end: Math.max(0, round(c.end + ms)) }))

/** Two-point linear resync: maps a1 to b1 and a2 to b2, stretching everything in between (and beyond). */
export function resync(cues: Cue[], a1: number, b1: number, a2: number, b2: number): Cue[] {
  if (a1 === a2) throw new Error('The two sync points must be at different times.')
  const k = (b2 - b1) / (a2 - a1)
  const map = (t: number) => Math.max(0, round(b1 + (t - a1) * k))
  return cues.map(c => ({ ...c, start: map(c.start), end: map(c.end) }))
}

/** Frame-rate conversion for speed-changed masters, e.g. 23.976 film transferred to 25 fps PAL runs 4.27% faster. */
export const convertFps = (cues: Cue[], from: number, to: number): Cue[] => cues.map(c => ({ ...c, start: round(c.start * from / to), end: round(c.end * from / to) }))

export const FPS = { film: 24000 / 1001, pal: 25 }
