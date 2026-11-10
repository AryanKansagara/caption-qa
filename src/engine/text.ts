import { primaryLang } from './rules.ts'

export const plain = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')

const CJK = new Set(['ja', 'zh', 'ko'])
export const isCJK = (lang: string) => CJK.has(primaryLang(lang))
const HAN_KANA = /[぀-ヿ㐀-鿿가-힯＀-￯]/

/** Characters as a viewer reads them: spaces and punctuation count, tags do not. */
export function lineChars(line: string, halfWidthLatin = false): number {
  const chars = [...plain(line)]
  if (!halfWidthLatin) return chars.length
  return chars.reduce((n, ch) => n + (HAN_KANA.test(ch) ? 1 : 0.5), 0)
}

export const textChars = (text: string, halfWidthLatin = false) => text.split('\n').reduce((n, l) => n + lineChars(l, halfWidthLatin), 0)

const segs = new Map<string, Intl.Segmenter>()
/** Language-aware word count: Intl.Segmenter splits CJK text into words without spaces. */
export function wordCount(text: string, lang = 'en'): number {
  const p = plain(text)
  try {
    const l = primaryLang(lang)
    if (!segs.has(l)) segs.set(l, new Intl.Segmenter(l, { granularity: 'word' }))
    let n = 0
    for (const x of segs.get(l)!.segment(p)) if (x.isWordLike) n++
    return n
  } catch {
    return p.split(/\s+/).filter(Boolean).length
  }
}

export const cps = (text: string, ms: number, halfWidthLatin = false) => ms > 0 ? textChars(text, halfWidthLatin) / (ms / 1000) : Infinity
export const wpm = (text: string, ms: number, lang = 'en') => ms > 0 ? wordCount(text, lang) / (ms / 60000) : Infinity

// Words a line should not end on: they belong with the noun or verb that follows.
const WEAK: Record<string, string[]> = {
  en: 'a an the of to in on at by for with from into onto about as and or but nor if that than my your his her its our their this these those is are was were be'.split(' '),
  es: 'el la los las un una unos unas de del al a en con por para sin sobre y o pero que si mi tu su nuestro'.split(' '),
  de: 'der die das den dem des ein eine einen einem einer eines und oder aber in im an am auf aus bei mit nach von vom zu zum zur für über unter vor durch dass wenn als mein dein sein ihr'.split(' '),
  fr: 'le la les un une des du de à au aux en et ou mais que si dans sur pour par avec sans mon ton son ma ta sa'.split(' '),
  it: 'il lo la i gli le un uno una di del della a al da in con su per e o ma che se'.split(' '),
  pt: 'o a os as um uma de do da dos das em no na com por para e ou mas que se'.split(' '),
}

export function weakEnd(line: string, lang: string): string | null {
  const words = plain(line).trim().split(/\s+/)
  const last = words.at(-1)?.toLowerCase().replace(/[^\p{L}']/gu, '') ?? ''
  if (!last || /[,.;:!?…]$/.test(plain(line).trim())) return null
  return (WEAK[primaryLang(lang)] ?? WEAK.en).includes(last) ? last : null
}

/** Is this a dialogue cue ("-Hi.\n-Hello.")? Those keep their own breaks. */
export const isDialogue = (text: string) => text.split('\n').length > 1 && text.split('\n').every(l => /^\s*(<i>)?\s*[-–]/.test(l))

function scoreBreak(a: string, b: string, max: number, lang: string, half: boolean) {
  const la = lineChars(a, half), lb = lineChars(b, half)
  // Small imbalances are fine; keeping linguistic units together matters more than equal lengths.
  let s = Math.max(0, Math.abs(la - lb) - 10)
  if (la > max) s += 1000 + (la - max) * 50
  if (lb > max) s += 1000 + (lb - max) * 50
  if (/[.,;:!?…。，、！？]$/.test(plain(a).trim())) s -= 12
  if (weakEnd(a, lang)) s += 25
  if (la > lb) s += 3 // prefer a bottom-heavy pyramid
  return s
}

/**
 * Re-breaks a cue: one line when it fits, otherwise the two-line split with the best balance that keeps
 * articles and prepositions with their nouns and prefers breaking after punctuation.
 */
export function rebreak(text: string, maxChars: number, lang = 'en', halfWidthLatin = false): string {
  if (isDialogue(text)) return text
  const flat = text.split('\n').map(s => s.trim()).join(isCJK(lang) ? '' : ' ').replace(/\s+/g, ' ').trim()
  if (lineChars(flat, halfWidthLatin) <= maxChars) return flat
  const cuts: number[] = []
  if (isCJK(lang) && !/\s/.test(flat)) {
    const chars = [...flat]
    let pos = 0
    for (let i = 0; i < chars.length - 1; i++) { pos += chars[i].length; cuts.push(pos) }
  } else {
    for (let i = 0; i < flat.length; i++) if (flat[i] === ' ') cuts.push(i)
  }
  let best = text, bestScore = Infinity
  for (const c of cuts) {
    const a = flat.slice(0, c).trim(), b = flat.slice(c).trim()
    if (!a || !b) continue
    const s = scoreBreak(a, b, maxChars, lang, halfWidthLatin)
    if (s < bestScore) { bestScore = s; best = `${a}\n${b}` }
  }
  return best
}

export const breakScore = (text: string, maxChars: number, lang: string, half: boolean) => {
  const l = text.split('\n')
  return l.length === 2 ? scoreBreak(l[0], l[1], maxChars, lang, half) : l.length === 1 ? 0 : 999
}

const STOP: Record<string, string[]> = {
  en: ['the', 'and', 'you', 'is', 'to', 'of', 'it', 'that', 'what', 'we', 'this', 'with'],
  es: ['el', 'la', 'que', 'de', 'y', 'los', 'es', 'en', 'por', 'una', 'con', 'para'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'ich', 'sie', 'es', 'wir', 'mit', 'ein'],
  fr: ['le', 'la', 'et', 'les', 'est', 'que', 'je', 'vous', 'pas', 'une', 'des', 'nous'],
  it: ['il', 'che', 'di', 'e', 'non', 'la', 'un', 'per', 'sono', 'una', 'con', 'mi'],
  pt: ['o', 'que', 'de', 'e', 'não', 'um', 'uma', 'os', 'para', 'com', 'você', 'ele'],
}

/** Rough language guess from the file name (`_de.srt`, `.es-ES.vtt`) and then from script and stopwords. */
export function guessLang(text: string, fileName = ''): string | null {
  const m = fileName.toLowerCase().match(/(?:^|[._\-\s])([a-z]{2})(?:[-_][a-z]{2,4})?\.(?:srt|vtt|ass|ssa|ttml|dfxp|xml|sbv)$/)
  if (m && m[1] in STOP || m && ['ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'tr', 'ar', 'hi', 'ru'].includes(m[1])) return m![1]
  const p = plain(text).slice(0, 20000)
  if (/[぀-ヿ]/.test(p)) return 'ja'
  if (/[가-힯]/.test(p)) return 'ko'
  if (/[一-鿿]/.test(p)) return 'zh'
  const words = p.toLowerCase().split(/[^\p{L}]+/u)
  let best: string | null = null, bestN = 0
  for (const [l, list] of Object.entries(STOP)) {
    const set = new Set(list)
    const n = words.reduce((k, w) => k + (set.has(w) ? 1 : 0), 0)
    if (n > bestN) { bestN = n; best = l }
  }
  return bestN >= 3 ? best : null
}

export type BreakProblem = 'too-long' | 'too-many' | 'weak-end' | 'one-line' | 'unbalanced' | null

/** Why a cue's line breaks are wrong, or null. Used by both the check and the fixer so they agree. */
export function breakProblem(text: string, maxChars: number, maxLines: number, lang: string, half = false): BreakProblem {
  const lines = text.split('\n')
  if (lines.some(l => lineChars(l, half) > maxChars)) return 'too-long'
  if (lines.length > maxLines) return 'too-many'
  if (isDialogue(text) || lines.length !== 2) return null
  if (weakEnd(lines[0], lang)) return 'weak-end'
  if (lineChars(lines.join(' '), half) <= maxChars) return 'one-line'
  const better = rebreak(text, maxChars, lang, half)
  return better !== text && breakScore(better, maxChars, lang, half) + 15 < breakScore(text, maxChars, lang, half) ? 'unbalanced' : null
}
