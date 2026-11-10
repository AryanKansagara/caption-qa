// Rule profiles. Values are editable in the app; the presets record where each number came from and when it was checked.

export interface Rules {
  maxCps: number
  maxWpm: number // 0 = not checked
  maxChars: number
  maxLines: number
  minDurationMs: number
  maxDurationMs: number
  minMsPerWord: number // 0 = not checked
  fps: number
  minGapFrames: number
  /** Gaps shorter than this (frames) should be closed to the minimum gap. 0 = not checked. */
  closeGapFrames: number
  /** A cue boundary this many frames from a shot change should snap to it. 0 = not checked. */
  shotChangeFrames: number
  /** Latin letters, digits, spaces and punctuation count as half a character (Netflix Korean rule). */
  halfWidthLatin: boolean
  forbiddenChars: string
  allowedTags: string[]
}

export interface Profile {
  id: string
  name: string
  short: string
  source: string
  url?: string
  verified: string
  base: Rules
  /** Per-language overrides, keyed by primary language subtag. */
  langs: Record<string, Partial<Rules> & { note?: string }>
  kids?: Record<string, number>
}

const NETFLIX_BASE: Rules = {
  maxCps: 17, maxWpm: 0, maxChars: 42, maxLines: 2,
  minDurationMs: 833, maxDurationMs: 7000, minMsPerWord: 0,
  fps: 24, minGapFrames: 2, closeGapFrames: 12, shotChangeFrames: 12,
  halfWidthLatin: false, forbiddenChars: '★●■▶►◆|', allowedTags: ['i'],
}

export const PROFILES: Profile[] = [
  {
    id: 'netflix', name: 'Netflix-style (adult)', short: 'Netflix', verified: '2026-11-09',
    source: 'Netflix Partner Help Center: Timed Text Style Guide General Requirements, Subtitle Timing Guidelines, and the per-language guides.',
    url: 'https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617',
    base: NETFLIX_BASE,
    langs: {
      en: { maxCps: 20, note: 'English (USA): 42 chars/line, 20 CPS adult, 17 CPS children' },
      es: { maxCps: 17, note: 'Spanish (LatAm & Spain): 42 chars/line, 17 CPS adult, 13 children' },
      de: { maxCps: 17, note: 'German: 42 chars/line, 17 CPS adult, 13 children' },
      fr: { maxCps: 17, note: 'French (France): 42 chars/line, 17 CPS adult, 13 children' },
      it: { maxCps: 17, note: 'Italian: 42 chars/line, 17 CPS adult, 13 children' },
      pt: { maxCps: 17, note: 'Portuguese (Brazil): 42 chars/line, 17 CPS adult, 13 children' },
      ja: { maxCps: 4, maxChars: 13, minDurationMs: 500, note: 'Japanese: 13 full-width chars/line, 4 CPS, 0.5 s minimum' },
      ko: { maxCps: 12, maxChars: 16, halfWidthLatin: true, note: 'Korean: 16 chars/line (Latin counts 0.5), 12 CPS adult, 9 children' },
      zh: { maxCps: 9, maxChars: 16, note: 'Chinese (Simplified): 16 chars/line, 9 CPS adult, 7 children' },
    },
    kids: { en: 17, es: 13, de: 13, fr: 13, it: 13, pt: 13, ja: 4, ko: 9, zh: 7 },
  },
  {
    id: 'bbc', name: 'BBC-style (broadcast)', short: 'BBC', verified: '2026-11-09',
    source: 'BBC Subtitle Guidelines: 160 to 180 words per minute, about 37 characters per line for broadcast, two lines, roughly 0.3 s per word. 25 fps.',
    url: 'https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/',
    base: { ...NETFLIX_BASE, maxCps: 0, maxWpm: 180, maxChars: 37, minDurationMs: 1000, maxDurationMs: 8000, minMsPerWord: 300, fps: 25, closeGapFrames: 0, shotChangeFrames: 0, allowedTags: ['i', 'b'] },
    langs: {},
  },
  {
    id: 'social', name: 'YouTube / social (house preset)', short: 'Social', verified: '2026-11-09',
    source: 'House preset for vertical and social video: short lines that survive a phone screen and burned-in styling. Not an official platform spec; tune it to your channel.',
    base: { ...NETFLIX_BASE, maxCps: 20, maxChars: 32, minDurationMs: 700, maxDurationMs: 6000, fps: 30, minGapFrames: 0, closeGapFrames: 0, shotChangeFrames: 0, forbiddenChars: '', allowedTags: ['i', 'b', 'u'] },
    langs: { ja: { maxChars: 13, maxCps: 6 }, zh: { maxChars: 16, maxCps: 9 }, ko: { maxChars: 16, maxCps: 12, halfWidthLatin: true } },
  },
]

export const CUSTOM_ID = 'custom'

export function customFrom(p: Profile, overrides: Partial<Rules> = {}): Profile {
  return { ...p, id: CUSTOM_ID, name: `Custom (from ${p.short})`, short: 'Custom', source: `Your own edits on top of ${p.name}.`, base: { ...p.base, ...overrides }, langs: p.langs }
}

export const primaryLang = (lang: string) => lang.toLowerCase().split(/[-_]/)[0]

export function rulesFor(p: Profile, lang: string, kids = false): Rules {
  const l = primaryLang(lang)
  const { note: _n, ...o } = p.langs[l] ?? {}
  const r = { ...p.base, ...o }
  if (kids && p.kids?.[l]) r.maxCps = p.kids[l]
  return r
}

export const frameMs = (r: Rules) => 1000 / r.fps

export const LANGS: Record<string, string> = { en: 'English', es: 'Spanish', de: 'German', fr: 'French', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', tr: 'Turkish', ar: 'Arabic', hi: 'Hindi', ru: 'Russian' }
export const langName = (l: string) => LANGS[primaryLang(l)] ?? l
