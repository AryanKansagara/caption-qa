import { frameMs, type Rules } from './rules.ts'
import type { Cue } from './types.ts'

function nearest(shots: number[], ms: number): number | undefined {
  let best: number | undefined
  for (const s of shots) if (best === undefined || Math.abs(s - ms) < Math.abs(best - ms)) best = s
  return best
}

/** The shot changes the in-time and the out-time should move to: the nearest one inside the window, none when the boundary is already on a cut. */
export function offCuts(c: Cue, shots: number[], r: Rules): { start?: number; end?: number } {
  const f = frameMs(r), w = r.shotChangeFrames * f
  const off = (ms: number, tolerance: number) => {
    const s = nearest(shots, ms)
    return s !== undefined && Math.abs(ms - s) > tolerance && Math.abs(ms - s) < w ? s : undefined
  }
  // An out-time belongs the minimum gap before the cut.
  return { start: off(c.start, f / 2), end: off(c.end, r.minGapFrames * f + f / 2) }
}
