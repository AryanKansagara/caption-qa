import { frameMs, type Rules } from './rules.ts'
import { breakProblem, cps, lineChars, plain, textChars, weakEnd, wordCount, wpm } from './text.ts'
import type { Cue } from './types.ts'

export type RuleId =
  | 'cps' | 'wpm' | 'line-length' | 'line-count' | 'line-break'
  | 'min-duration' | 'max-duration' | 'overlap' | 'gap' | 'shot-change'
  | 'expansion' | 'untranslated' | 'numbers' | 'names' | 'chars' | 'tags' | 'empty'

export const RULES: { id: RuleId; label: string; desc: string; needsSource?: boolean }[] = [
  { id: 'cps', label: 'Reading speed (CPS)', desc: 'Characters per second, spaces and punctuation included, tags excluded.' },
  { id: 'wpm', label: 'Words per minute', desc: 'Language-aware word count (CJK is segmented, not split on spaces).' },
  { id: 'line-length', label: 'Line length', desc: 'Characters per line against the profile limit.' },
  { id: 'line-count', label: 'Line count', desc: 'Lines per cue.' },
  { id: 'line-break', label: 'Line breaks', desc: 'Articles and prepositions kept with their nouns; one line when it fits; balanced, bottom-heavy pyramid.' },
  { id: 'min-duration', label: 'Flashing cues', desc: 'Cues shorter than the minimum duration (or the per-word minimum).' },
  { id: 'max-duration', label: 'Maximum duration', desc: 'Cues on screen longer than the limit.' },
  { id: 'overlap', label: 'Overlaps', desc: 'A cue starts before the previous one ends.' },
  { id: 'gap', label: 'Gaps', desc: 'Gaps below the minimum frame gap, or short gaps that should be closed.' },
  { id: 'shot-change', label: 'Shot changes', desc: 'In or out times a few frames off a shot change.' },
  { id: 'expansion', label: 'Translation expansion', desc: 'Target length against the aligned source line.', needsSource: true },
  { id: 'untranslated', label: 'Untranslated lines', desc: 'Target text identical to the source.', needsSource: true },
  { id: 'numbers', label: 'Number consistency', desc: 'Digits in the source missing or changed in the target.', needsSource: true },
  { id: 'names', label: 'Name consistency', desc: 'Proper names in the source missing from the target.', needsSource: true },
  { id: 'chars', label: 'Forbidden characters', desc: 'Characters the profile bans, control characters and replacement glyphs.' },
  { id: 'tags', label: 'Tags and italics', desc: 'Unbalanced or disallowed formatting tags.' },
  { id: 'empty', label: 'Empty cues', desc: 'Cues with no visible text.' },
]
export const ruleLabel = (id: RuleId) => RULES.find(r => r.id === id)?.label ?? id

export type Severity = 'error' | 'warn'
export interface Issue { rule: RuleId; cueId: string; severity: Severity; message: string }

export interface Context {
  lang: string
  /** Shot changes in ms, sorted. */
  shots?: number[]
  /** Source cues for translation checks. */
  source?: Cue[]
  sourceLang?: string
}

const fmtS = (ms: number) => `${(ms / 1000).toFixed(2)} s`

// ---------- Alignment ----------

/** For each target cue, the source cues it overlaps in time (or the nearest one within 1 s). */
export function align(target: Cue[], source: Cue[]): Map<string, Cue[]> {
  const out = new Map<string, Cue[]>()
  let j = 0
  for (const t of target) {
    while (j < source.length && source[j].end <= t.start - 1000) j++
    const hits: Cue[] = []
    let near: Cue | null = null, nearD = 1001
    for (let k = Math.max(0, j - 1); k < source.length && source[k].start < t.end + 1000; k++) {
      const s = source[k]
      const ov = Math.min(s.end, t.end) - Math.max(s.start, t.start)
      // Count a source cue when the overlap is a real share of either cue, not a few frames at the edge.
      if (ov > 0 && ov >= 0.3 * Math.min(s.end - s.start, t.end - t.start)) hits.push(s)
      const d = Math.abs((s.start + s.end) / 2 - (t.start + t.end) / 2)
      if (d < nearD) { nearD = d; near = s }
    }
    out.set(t.id, hits.length ? hits : near ? [near] : [])
  }
  return out
}

const normalizeNum = (s: string) => s.replace(/(?<=\d)[.,\s](?=\d{3}\b)/g, '').replace(',', '.')
const numbersIn = (t: string) => (plain(t).match(/\d+(?:[.,\s]\d{3})*(?:[.,]\d+)?/g) ?? []).map(normalizeNum).sort()

const HONORIFICS = new Set(['Mr', 'Mrs', 'Ms', 'Dr', 'Sr', 'Sra', 'Herr', 'Frau', 'Mme', 'Mlle', 'Sir', 'Madam'])

/** Capitalised words that are not sentence-initial: a cheap but useful proper-name detector. */
export function namesIn(t: string): string[] {
  const out: string[] = []
  const s = plain(t).replace(/\n/g, ' ')
  const re = /(^|[.!?¿¡…]\s+|\s|-)([\p{Lu}][\p{Ll}]+(?:[-'][\p{Lu}]?[\p{Ll}]+)?)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const sentenceStart = m.index === 0 || /[.!?¿¡…]\s+$/.test(m[1]) || m[1] === '-' && (m.index === 0 || s[m.index - 1] === ' ')
    if (!sentenceStart && m[2].length > 1 && !HONORIFICS.has(m[2])) out.push(m[2])
  }
  return out
}

export interface ExpansionRow { cueId: string; source: string; target: string; ratio: number }

export function expansion(target: Cue[], source: Cue[]): { rows: ExpansionRow[]; overall: number; median: number } {
  const a = align(target, source)
  const rows: ExpansionRow[] = []
  let ts = 0, ss = 0
  for (const t of target) {
    const src = a.get(t.id) ?? []
    if (!src.length) continue
    const st = src.map(s => s.text).join(' ')
    const sl = textChars(st), tl = textChars(t.text)
    if (sl < 1) continue
    rows.push({ cueId: t.id, source: st, target: t.text, ratio: tl / sl })
    ts += tl; ss += sl
  }
  const sorted = rows.map(r => r.ratio).sort((x, y) => x - y)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1
  return { rows, overall: ss ? ts / ss : 1, median }
}

// ---------- QC ----------

export function check(cues: Cue[], r: Rules, ctx: Context): Issue[] {
  const out: Issue[] = []
  const f = frameMs(r)
  const minGap = r.minGapFrames * f
  const add = (rule: RuleId, c: Cue, severity: Severity, message: string) => out.push({ rule, cueId: c.id, severity, message })
  const allowed = new Set(r.allowedTags)
  const shots = ctx.shots ?? []
  const half = r.halfWidthLatin

  cues.forEach((c, i) => {
    const dur = c.end - c.start
    const p = plain(c.text).trim()
    if (!p) { add('empty', c, 'warn', 'No visible text.'); return }
    const lines = c.text.split('\n')

    if (r.maxCps > 0 && dur > 0) {
      const v = cps(c.text, dur, half)
      if (v > r.maxCps + 0.05) add('cps', c, v > r.maxCps * 1.25 ? 'error' : 'warn', `${v.toFixed(1)} CPS over the ${r.maxCps} CPS limit (${textChars(c.text, half)} chars in ${fmtS(dur)}).`)
    }
    if (r.maxWpm > 0 && dur > 0) {
      const v = wpm(c.text, dur, ctx.lang)
      if (v > r.maxWpm + 0.5) add('wpm', c, v > r.maxWpm * 1.25 ? 'error' : 'warn', `${Math.round(v)} WPM over the ${r.maxWpm} WPM limit.`)
    }
    lines.forEach((l, k) => {
      const n = lineChars(l, half)
      if (n > r.maxChars) add('line-length', c, 'error', `Line ${k + 1} has ${n} characters (max ${r.maxChars}).`)
    })
    if (lines.length > r.maxLines) add('line-count', c, 'error', `${lines.length} lines (max ${r.maxLines}).`)
    else {
      const bp = breakProblem(c.text, r.maxChars, r.maxLines, ctx.lang, half)
      if (bp === 'weak-end') add('line-break', c, 'warn', `Line 1 ends on "${weakEnd(lines[0], ctx.lang)}", which belongs with the next line.`)
      else if (bp === 'one-line') add('line-break', c, 'warn', 'Fits on one line but is split over two.')
      else if (bp === 'unbalanced') add('line-break', c, 'warn', 'Unbalanced lines; a better break is available.')
    }

    const minDur = Math.max(r.minDurationMs, r.minMsPerWord * wordCount(c.text, ctx.lang))
    if (dur > 0 && dur < minDur - 1) add('min-duration', c, dur < r.minDurationMs ? 'error' : 'warn', `On screen for ${fmtS(dur)}; needs at least ${fmtS(minDur)}.`)
    if (dur > r.maxDurationMs + 1) add('max-duration', c, 'warn', `On screen for ${fmtS(dur)} (max ${fmtS(r.maxDurationMs)}).`)
    if (dur <= 0) add('min-duration', c, 'error', 'Zero or negative duration.')

    const prev = cues[i - 1]
    if (prev) {
      const gap = c.start - prev.end
      if (gap < 0) add('overlap', c, 'error', `Starts ${-gap} ms before the previous cue ends.`)
      else if (gap < minGap - 1) add('gap', c, 'error', `Gap of ${Math.round(gap / f)} frames before this cue (min ${r.minGapFrames}).`)
      else if (r.closeGapFrames > 0 && gap < r.closeGapFrames * f - 1 && gap > minGap + 1) add('gap', c, 'warn', `Gap of ${Math.round(gap / f)} frames: close it to ${r.minGapFrames} frames.`)
    }

    if (r.shotChangeFrames > 0 && shots.length) {
      const w = r.shotChangeFrames * f
      for (const s of shots) {
        if (s < c.start - w) continue
        if (s > c.end + w) break
        const dIn = c.start - s, dOut = s - c.end
        if (Math.abs(dIn) > f / 2 && Math.abs(dIn) < w) { add('shot-change', c, 'warn', `Starts ${Math.round(Math.abs(dIn) / f)} frames ${dIn > 0 ? 'after' : 'before'} a shot change; snap it to the cut.`); break }
        if (Math.abs(dOut) > minGap + f / 2 && Math.abs(dOut) < w) { add('shot-change', c, 'warn', `Ends ${Math.round(Math.abs(dOut) / f)} frames ${dOut > 0 ? 'before' : 'after'} a shot change; end ${r.minGapFrames} frames before the cut.`); break }
      }
    }

    const bad = [...p].filter(ch => r.forbiddenChars.includes(ch) || /[\u0000-\u0008\u000b-\u001f\u007f�]/.test(ch))
    if (bad.length) add('chars', c, 'error', `Forbidden character${bad.length > 1 ? 's' : ''}: ${[...new Set(bad)].map(ch => /\p{C}/u.test(ch) ? `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : ch).join(' ')}`)

    const stack: string[] = []
    let tagErr: string | null = null
    for (const m of c.text.matchAll(/<(\/?)([a-z]+)[^>]*>/gi)) {
      const name = m[2].toLowerCase()
      if (!allowed.has(name)) { tagErr ??= `Tag <${name}> is not allowed by this profile.`; continue }
      if (!m[1]) stack.push(name)
      else if (stack.pop() !== name) tagErr ??= `Closing </${name}> without a matching <${name}>.`
    }
    if (stack.length) tagErr ??= `<${stack[0]}> is never closed.`
    if (/\{\\/.test(c.text)) tagErr ??= 'ASS override codes left in the text.'
    if (tagErr) add('tags', c, 'error', tagErr)
  })

  if (ctx.source?.length) {
    const al = align(cues, ctx.source)
    const ex = expansion(cues, ctx.source)
    const byId = new Map(ex.rows.map(rw => [rw.cueId, rw]))
    for (const c of cues) {
      const src = al.get(c.id) ?? []
      if (!src.length || !plain(c.text).trim()) continue
      const st = src.map(s => s.text).join('\n')
      const rw = byId.get(c.id)
      if (rw && textChars(st) >= 12) {
        if (rw.ratio > 1.45) add('expansion', c, 'warn', `${Math.round((rw.ratio - 1) * 100)}% longer than the source line.`)
        else if (rw.ratio < 0.55) add('expansion', c, 'warn', `${Math.round((1 - rw.ratio) * 100)}% shorter than the source line; check nothing was dropped.`)
      }
      const norm = (s: string) => plain(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      if (norm(c.text) === norm(st) && /\p{L}{3}/u.test(norm(st)) && norm(st).split(' ').length > 1) add('untranslated', c, 'error', 'Identical to the source; looks untranslated.')
      const sn = numbersIn(st), tn = numbersIn(c.text)
      const missing = sn.filter(n => { const k = tn.indexOf(n); if (k >= 0) { tn.splice(k, 1); return false } return true })
      if (missing.length) add('numbers', c, 'warn', `Source number${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not found in the target.`)
      const tp = plain(c.text)
      const lost = [...new Set(namesIn(st))].filter(n => !tp.includes(n))
      if (lost.length) add('names', c, 'warn', `Name${lost.length > 1 ? 's' : ''} ${lost.join(', ')} from the source not found in the target.`)
    }
  }
  return out
}

// ---------- Score and summaries ----------

export interface RuleSummary { id: RuleId; errors: number; warnings: number; pass: boolean }

export function summarize(issues: Issue[], hasSource: boolean): RuleSummary[] {
  return RULES.filter(r => hasSource || !r.needsSource).map(r => {
    const list = issues.filter(i => i.rule === r.id)
    const errors = list.filter(i => i.severity === 'error').length
    return { id: r.id, errors, warnings: list.length - errors, pass: errors === 0 }
  })
}

/** 100 when clean. Each error costs one cue's share, each warning 0.35, capped at 3 points of penalty per cue. */
export function score(cues: Cue[], issues: Issue[]): number {
  if (!cues.length) return 0
  const per = new Map<string, number>()
  for (const i of issues) per.set(i.cueId, (per.get(i.cueId) ?? 0) + (i.severity === 'error' ? 1 : 0.35))
  let pen = 0
  for (const v of per.values()) pen += Math.min(3, v)
  return Math.max(0, Math.round(100 * (1 - pen / cues.length)))
}
