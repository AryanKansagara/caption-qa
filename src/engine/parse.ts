import { lastOnScreen, type Cue, type Format, type ParseIssue, type ParseResult } from './types.ts'

// ---------- Encoding ----------

/** Decodes bytes using the BOM when present, then UTF-16 heuristics, then strict UTF-8, falling back to Windows-1252. */
export function decode(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16 LE (BOM)' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16 BE (BOM)' }
  // No BOM: mostly-ASCII UTF-16 has a zero in every other byte.
  const n = Math.min(bytes.length, 4000)
  let evenZero = 0, oddZero = 0
  for (let i = 0; i < n; i++) if (bytes[i] === 0) { if (i % 2) oddZero++; else evenZero++ }
  if (n > 8 && oddZero > n * 0.3) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16 LE' }
  if (n > 8 && evenZero > n * 0.3) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16 BE' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' }
  }
}

// ---------- Detection ----------

export function detectFormat(text: string, fileName = ''): Format | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  const head = text.replace(/^﻿/, '').trimStart().slice(0, 2000)
  if (/^WEBVTT/.test(head)) return 'vtt'
  if (/^\[Script Info\]/i.test(head) || /^\[V4\+? Styles\]/im.test(head) || /^Dialogue:/m.test(head)) return 'ass'
  if (/<(\w+:)?tt[\s>]/.test(head) || /<\?xml/.test(head) && /<(\w+:)?(tt|p)\s/.test(text.slice(0, 6000))) return 'ttml'
  if (/^\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/m.test(head)) return 'srt'
  if (/^\d{1,2}:\d{2}:\d{2}\.\d{3},\d{1,2}:\d{2}:\d{2}\.\d{3}\s*$/m.test(head)) return 'sbv'
  if (/-->/.test(head)) return ext === 'vtt' ? 'vtt' : 'srt'
  const byExt: Record<string, Format> = { srt: 'srt', vtt: 'vtt', ass: 'ass', ssa: 'ass', ttml: 'ttml', dfxp: 'ttml', xml: 'ttml', sbv: 'sbv' }
  return byExt[ext] ?? null
}

// ---------- Helpers ----------

const lines = (text: string) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')

/** Parses "HH:MM:SS,mmm", "MM:SS.mmm", "H:MM:SS.cc" style clocks. Returns null when invalid. */
export function parseClock(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/)
  if (!m) return null
  const [h, mi, se] = [+(m[1] ?? 0), +m[2], +m[3]]
  if (mi > 59 || se > 59) return null
  const frac = m[4] ? Math.round(+m[4].padEnd(3, '0')) : 0
  return ((h * 60 + mi) * 60 + se) * 1000 + frac
}

const TC = String.raw`(\d+:\d{1,2}:\d{1,2}[.,]\d{1,3}|\d{1,2}:\d{1,2}[.,]\d{1,3})`
const ARROW = new RegExp(`^\\s*${TC}\\s*-->\\s*${TC}`)
/** A line meant as a timing line, even when a time in it is unreadable. */
const TC_LIKE = /^\s*\d\S*:\S*[:.,]\S+\s*-->\s*\S+:\S*[:.,]\S+/

/** Overlap and negative-duration checks shared by every format. `lineOf` maps cue index to its source line. */
export function validateTiming(cues: Cue[], lineOf: number[]): ParseIssue[] {
  const out: ParseIssue[] = []
  // By start time, the earlier cue that is on screen longest.
  const order = cues.map((_, i) => i).sort((a, b) => cues[a].start - cues[b].start || a - b)
  const longest = new Map(lastOnScreen(order.map(i => cues[i])).map((k, n) => [order[n], order[k] ?? -1]))
  cues.forEach((c, i) => {
    const line = lineOf[i] ?? 0
    if (c.end <= c.start) out.push({ line, kind: 'negative', severity: 'error', message: c.end === c.start ? 'Zero-length cue: end time equals start time.' : `End time is before start time (${fmtTime(c.end)} < ${fmtTime(c.start)}).` })
    const prev = cues[i - 1]
    if (prev && c.start < prev.end) out.push({ line, kind: 'overlap', severity: 'error', message: `Overlaps the previous cue by ${prev.end - c.start} ms (starts ${fmtTime(c.start)}, previous ends ${fmtTime(prev.end)}).` })
    else {
      const k = longest.get(i)!, long = cues[k]
      if (long && k < i && c.start < long.end) out.push({ line, kind: 'overlap', severity: 'error', message: `Overlaps the cue on line ${lineOf[k] ?? 0} by ${long.end - c.start} ms (starts ${fmtTime(c.start)}, that cue ends ${fmtTime(long.end)}).` })
    }
    if (!c.text.trim()) out.push({ line, kind: 'empty', severity: 'warn', message: 'Cue has no text.' })
  })
  return out
}

export function fmtTime(ms: number, sep = '.') {
  const neg = ms < 0 ? '-' : ''
  ms = Math.abs(Math.round(ms))
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60
  return `${neg}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`
}

const sortByStart = (cues: Cue[], lineOf: number[]) => {
  const idx = cues.map((_, i) => i).sort((a, b) => cues[a].start - cues[b].start || a - b)
  return { cues: idx.map(i => cues[i]), lineOf: idx.map(i => lineOf[i]) }
}

const ensureIds = (cues: Cue[]) => cues.forEach((c, i) => { c.id = `c${i + 1}` })

// ---------- SRT / VTT ----------

const VTT_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f', quot: '"', apos: "'" }
const vttUnescape = (s: string) => s.replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);/g, (_, n) => VTT_ENTITIES[n])

function parseArrowBlocks(text: string, vtt: boolean): { cues: Cue[]; lineOf: number[]; issues: ParseIssue[] } {
  const L = lines(text)
  const cues: Cue[] = [], lineOf: number[] = [], issues: ParseIssue[] = []
  let i = 0
  if (vtt) {
    if (!/^WEBVTT/.test(L[0] ?? '')) issues.push({ line: 1, kind: 'format', severity: 'error', message: 'WebVTT files must start with "WEBVTT".' })
    while (i < L.length && L[i].trim() !== '' && !TC_LIKE.test(L[i])) i++
    if (i > 0 && i < L.length && L[i].trim() !== '') issues.push({ line: i + 1, kind: 'format', severity: 'warn', message: 'Blank line missing after the WebVTT header.' })
  }
  let expectNum = 1
  while (i < L.length) {
    while (i < L.length && L[i].trim() === '') i++
    if (i >= L.length) break
    let from = i
    const rows: string[] = []
    while (i < L.length && L[i].trim() !== '') rows.push(L[i++])
    if (vtt && /^(NOTE|STYLE|REGION)\b/.test(rows[0])) {
      // A comment cannot contain a timing line: on the second line this is a cue identifier, further down a new cue starts there.
      const at = rows.findIndex(l => ARROW.test(l))
      if (at < 0) continue
      if (at > 1) from += rows.splice(0, at).length
    }
    // One entry per cue: usually the whole block, more when the blank line between cues is missing.
    const starts = [0]
    const head = rows.findIndex(l => TC_LIKE.test(l))
    for (let k = (head >= 0 ? head : rows.findIndex(l => l.includes('-->'))) + 1; k > 0 && k < rows.length; k++) {
      if (!TC_LIKE.test(rows[k])) continue
      const numbered = /^\s*\d+\s*$/.test(rows[k - 1]) && !TC_LIKE.test(rows[k - 1])
      starts.push(numbered && k - 1 > starts.at(-1)! ? k - 1 : k)
    }
    starts.forEach((at, n) => {
      const blockStart = from + at
      const block = rows.slice(at, starts[n + 1])
      if (n) issues.push({ line: blockStart + 1, kind: 'format', severity: 'warn', message: 'Blank line missing before this cue.' })
      const timing = block.findIndex(l => ARROW.test(l))
      const k = timing >= 0 ? timing : block.findIndex(l => l.includes('-->'))
      if (k < 0) {
        issues.push({ line: blockStart + 1, kind: 'timecode', severity: 'error', message: `No timecode line found in this block ("${block[0].slice(0, 40)}"). Block skipped.` })
        return
      }
      if (!vtt) {
        const num = block[0].trim()
        if (k === 0) issues.push({ line: blockStart + 1, kind: 'numbering', severity: 'warn', message: 'Cue number missing before the timecode.' })
        else if (!/^\d+$/.test(num)) issues.push({ line: blockStart + 1, kind: 'numbering', severity: 'warn', message: `Cue number "${num.slice(0, 20)}" is not a number.` })
        else if (+num !== expectNum && !(cues.length === 0 && +num === 0)) issues.push({ line: blockStart + 1, kind: 'numbering', severity: 'warn', message: `Numbering jumps: expected ${expectNum}, found ${num}.` })
        if (/^\d+$/.test(num)) expectNum = +num + 1
        else expectNum++
      }
      const m = block[k].match(ARROW)
      const lineNo = blockStart + k + 1
      if (!m) {
        issues.push({ line: lineNo, kind: 'timecode', severity: 'error', message: `Unreadable timecode "${block[k].trim().slice(0, 60)}". Cue skipped.` })
        return
      }
      const start = parseClock(m[1]), end = parseClock(m[2])
      if (start === null || end === null) {
        issues.push({ line: lineNo, kind: 'timecode', severity: 'error', message: `Invalid time value in "${block[k].trim()}". Cue skipped.` })
        return
      }
      if (!vtt && m[1].includes('.')) issues.push({ line: lineNo, kind: 'timecode', severity: 'warn', message: 'SRT timecodes should use a comma before milliseconds.' })
      let body = block.slice(k + 1).join('\n')
      if (vtt) body = vttUnescape(body.replace(/<(\/?)(c|v|lang|ruby|rt)(\.[^>\s]*)?(\s[^>]*)?>/g, '').replace(/<\d+:\d{2}[:.][\d.:]+>/g, ''))
      body = body.replace(/<font[^>]*>|<\/font>/gi, '').replace(/\{\\an\d\}/g, '')
      cues.push({ id: '', start, end, text: body.trim() })
      lineOf.push(lineNo)
    })
  }
  return { cues, lineOf, issues }
}

// ---------- ASS / SSA ----------

function assTime(s: string) { return parseClock(s) }

/** Null when the line only draws: after \p1 (or a larger scale) the text is vector commands, until \p0. */
function assText(t: string): string | null {
  let out = '', italic = false, drawing = false, drew = false
  for (const part of t.split(/(\{[^}]*\})/)) {
    if (part.startsWith('{')) {
      const im = part.match(/\\i([01])/)
      if (im) {
        if (im[1] === '1' && !italic) { out += '<i>'; italic = true }
        if (im[1] === '0' && italic) { out += '</i>'; italic = false }
      }
      const scale = [...part.matchAll(/\\p\s*(\d+)/g)].at(-1)
      if (scale) drawing = +scale[1] > 0
      continue
    }
    if (drawing) { drew ||= part.trim() !== ''; continue }
    out += part.replace(/\\N/gi, '\n').replace(/\\h/g, ' ')
  }
  if (italic) out += '</i>'
  out = out.replace(/<i>(\s*)<\/i>/g, '$1').trim()
  return !out && drew ? null : out
}

function parseAss(text: string) {
  const L = lines(text)
  const cues: Cue[] = [], lineOf: number[] = [], issues: ParseIssue[] = []
  let fields: string[] | null = null
  let inEvents = false
  L.forEach((raw, i) => {
    const l = raw.trim()
    if (/^\[.*\]$/.test(l)) { inEvents = /^\[Events\]$/i.test(l); return }
    if (!inEvents) return
    if (/^Format:/i.test(l)) { fields = l.slice(7).split(',').map(s => s.trim().toLowerCase()); return }
    const dm = l.match(/^Dialogue:\s*(.*)$/i)
    if (!dm) return
    const f = fields ?? ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
    const parts = dm[1].split(',')
    const vals = [...parts.slice(0, f.length - 1), parts.slice(f.length - 1).join(',')]
    const get = (k: string) => vals[f.indexOf(k)] ?? ''
    const start = assTime(get('start')), end = assTime(get('end'))
    if (start === null || end === null) {
      issues.push({ line: i + 1, kind: 'timecode', severity: 'error', message: `Invalid ASS time "${get('start')}" / "${get('end')}". Line skipped.` })
      return
    }
    const body = assText(get('text'))
    if (body === null) return
    cues.push({ id: '', start, end, text: body })
    lineOf.push(i + 1)
  })
  if (!fields && cues.length === 0) issues.push({ line: 1, kind: 'format', severity: 'error', message: 'No [Events] section with Dialogue lines found.' })
  return { cues, lineOf, issues }
}

// ---------- TTML / DFXP ----------

function ttmlTime(s: string, fps: number, tickRate: number): number | null {
  s = s.trim()
  let m = s.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/)
  if (m) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + (m[4] ? Math.round(+`0.${m[4]}` * 1000) : 0)
  m = s.match(/^(\d+):(\d{2}):(\d{2}):(\d+)(?:\.\d+)?$/)
  if (m) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Math.round(+m[4] * 1000 / fps)
  m = s.match(/^(\d{1,2}):(\d{2})\.(\d+)$/)
  if (m) return (+m[1] * 60 + +m[2]) * 1000 + Math.round(+`0.${m[3]}` * 1000)
  // Bare seconds are not valid TTML but Apple/iTunes files use them.
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s * 1000)
  m = s.match(/^(\d+\.?\d*|\.\d+)(h|m|s|ms|f|t)$/)
  if (m) {
    const v = +m[1]
    const mult: Record<string, number> = { h: 3600000, m: 60000, s: 1000, ms: 1, f: 1000 / fps, t: 1000 / tickRate }
    return Math.round(v * mult[m[2]])
  }
  return null
}

const xmlUnescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&')

function parseTtml(text: string) {
  // EBU-TT and some broadcast exports prefix every element (<tt:p>, <tt:br/>). Same length per line, so line numbers stay right.
  text = text.replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, '<$1')
  // Comments are blanked, not cut, so line numbers stay right.
  text = text.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, ' '))
  const cues: Cue[] = [], lineOf: number[] = [], issues: ParseIssue[] = []
  const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))?.slice(1).find(v => v !== undefined)
  const tt = text.match(/<tt[\s>][^>]*>/)?.[0] ?? ''
  // A rate that cannot be read is NaN, which makes every time that needs it unreadable.
  const rate = (name: string, fallback: number) => {
    const v = attr(tt, name)
    if (v === undefined) return fallback
    // "1000 1001" in TTML, "1000:1001" in DFXP.
    const m = name === 'frameRateMultiplier' ? v.trim().match(/^(\d+(?:\.\d+)?)(?:[\s:]+(\d+))?$/) : v.trim().match(/^(\d+(?:\.\d+)?)$/)
    const n = m ? +m[1] / +(m[2] ?? 1) : NaN
    if (Number.isFinite(n) && n > 0) return n
    issues.push({ line: 1, kind: 'format', severity: 'error', message: `Unreadable ${name}="${v.slice(0, 40)}". Times that need it are skipped.` })
    return NaN
  }
  const fps = rate('frameRate', 30) * rate('frameRateMultiplier', 1)
  const tickRate = rate('tickRate', 10000000)
  if (tt && !/<\/tt\s*>/.test(text)) issues.push({ line: 1, kind: 'format', severity: 'error', message: 'The file ends before </tt>: it is cut off and cues are missing.' })
  const lineStarts: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineAt = (pos: number) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1 } return lo + 1 }
  // Italics can be inline (tts:fontStyle) or come from a <style xml:id=".."> referenced by style="..".
  const italicStyles = new Set<string>()
  for (const sm of text.matchAll(/<style\b([^>]*)\/?>/g)) {
    const id = attr(sm[1], 'id')
    if (id && attr(sm[1], 'fontStyle') === 'italic') italicStyles.add(id)
  }
  const isItalic = (at: string) => attr(at, 'fontStyle') === 'italic' || (attr(at, 'style') ?? '').split(/\s+/).some(id => italicStyles.has(id))
  const re = /<p\b([^>]*?)(?:\/>|>([\s\S]*?)<\/p>)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const line = lineAt(m.index)
    const content = m[2] ?? '' // none in <p .../>
    const b = attr(m[1], 'begin'), e = attr(m[1], 'end'), d = attr(m[1], 'dur')
    const start = b ? ttmlTime(b, fps, tickRate) : null
    let end = e ? ttmlTime(e, fps, tickRate) : null
    if (end === null && d && start !== null) { const dd = ttmlTime(d, fps, tickRate); end = dd === null ? null : start + dd }
    if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) {
      if (m[2] === undefined && !b && !e && !d) continue
      issues.push({ line, kind: 'timecode', severity: 'error', message: `Missing or unreadable begin/end on <p> (begin="${b ?? ''}", end="${e ?? d ?? ''}"). Cue skipped.` })
      continue
    }
    const raw = isItalic(m[1]) ? `<span tts:fontStyle="italic">${content}</span>` : content
    const body = raw
      .replace(/\s*\n\s*/g, ' ')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/g, (all, at: string, inner: string) => isItalic(at) ? `<i>${inner}</i>` : all)
      .replace(/<(?!\/?i>)[^>]+>/g, '')
    cues.push({ id: '', start, end, text: xmlUnescape(body).split('\n').map(s => s.trim()).join('\n').trim() })
    lineOf.push(line)
  }
  if (!cues.length && !issues.length) issues.push({ line: 1, kind: 'format', severity: 'error', message: 'No <p begin=".." end=".."> elements found.' })
  return { cues, lineOf, issues, frameRate: Number.isFinite(fps) ? fps : undefined }
}

// ---------- SBV ----------

function parseSbv(text: string) {
  const L = lines(text)
  const cues: Cue[] = [], lineOf: number[] = [], issues: ParseIssue[] = []
  let i = 0
  while (i < L.length) {
    while (i < L.length && L[i].trim() === '') i++
    if (i >= L.length) break
    const head = L[i].trim(), lineNo = i + 1
    const block: string[] = []
    i++
    while (i < L.length && L[i].trim() !== '') block.push(L[i++])
    const m = head.match(/^([\d:.]+),([\d:.]+)$/)
    const start = m ? parseClock(m[1]) : null, end = m ? parseClock(m[2]) : null
    if (start === null || end === null) {
      issues.push({ line: lineNo, kind: 'timecode', severity: 'error', message: `Unreadable SBV timecode "${head.slice(0, 50)}". Block skipped.` })
      continue
    }
    cues.push({ id: '', start, end, text: block.join('\n').trim() })
    lineOf.push(lineNo)
  }
  return { cues, lineOf, issues }
}

// ---------- Entry point ----------

export function parse(text: string, format?: Format | null, fileName?: string): ParseResult {
  const fmt = format ?? detectFormat(text, fileName) ?? 'srt'
  const r = fmt === 'srt' ? parseArrowBlocks(text, false)
    : fmt === 'vtt' ? parseArrowBlocks(text, true)
    : fmt === 'ass' ? parseAss(text)
    : fmt === 'ttml' ? parseTtml(text)
    : parseSbv(text)
  // Overlaps are checked in file order (that is how a player reads them), then cues are sorted.
  const timing = validateTiming(r.cues, r.lineOf)
  const sorted = sortByStart(r.cues, r.lineOf)
  if (sorted.lineOf.some((l, i) => l !== r.lineOf[i])) timing.push({ line: 0, kind: 'format', severity: 'warn', message: 'Cues were out of order and have been sorted by start time.' })
  ensureIds(sorted.cues)
  if (!sorted.cues.length && !r.issues.some(i => i.severity === 'error')) r.issues.push({ line: 1, kind: 'format', severity: 'error', message: 'No cues found in this file.' })
  const issues = [...r.issues, ...timing].sort((a, b) => a.line - b.line)
  return { format: fmt, cues: sorted.cues, issues, frameRate: 'frameRate' in r ? r.frameRate as number : undefined }
}

export function parseBytes(bytes: Uint8Array, fileName?: string, format?: Format | null): ParseResult {
  const { text, encoding } = decode(bytes)
  const r = parse(text, format, fileName)
  r.encoding = encoding
  if (encoding === 'Windows-1252') r.issues.unshift({ line: 0, kind: 'encoding', severity: 'warn', message: 'File is not valid UTF-8; decoded as Windows-1252. Exports are written as UTF-8.' })
  if (/�/.test(text)) r.issues.unshift({ line: 0, kind: 'encoding', severity: 'warn', message: 'Some characters could not be decoded (shown as �).' })
  return r
}

const numeric = (s: string) => /^\d+(\.\d+)?$/.test(s)

/** One time: SMPTE timecode, seconds or a clock. Null when unreadable or out of range. */
function shotTime(v: string, fps: number): number | null {
  const m = v.match(/^(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,2})|;(\d{2}))$/)
  if (!m) return numeric(v) ? Math.round(+v * 1000) : parseClock(v)
  const frames = +(m[4] ?? m[5])
  if (+m[2] > 59 || +m[3] > 59 || frames >= fps) return null
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Math.round(frames * 1000 / fps)
}

/**
 * Shot list: one cut per line as seconds (12.48), a clock (00:00:12.480) or SMPTE timecode (00:00:12:12, frames at `fps`).
 * CSV rows use the first column, or the start time column of a PySceneDetect scene list.
 */
export function parseShotList(text: string, fps = 24): { shots: number[]; bad: number[] } {
  const shots: number[] = [], bad: number[] = []
  let column = -1
  lines(text).forEach((raw, i) => {
    const cells = raw.split(/[,;\t]/).map(c => c.trim())
    if (cells.includes('Scene Number') && cells.some(c => /^Start Time/.test(c))) {
      column = cells.indexOf('Start Time (seconds)')
      if (column < 0) column = cells.indexOf('Start Timecode')
      return
    }
    const first = cells[0]
    if (!first || /^[a-z#]/i.test(first)) return
    let ms: number | null
    if (column >= 0) {
      ms = shotTime(cells[column] ?? '', fps)
      if (ms === 0) return // the first scene starts with the video; that is not a cut
    } else {
      // The separators also occur inside times: drop-frame 00:00:12;12 and the comma clock 00:00:12,480.
      const whole = raw.trim().match(/^(\d{1,2}:\d{2}:\d{2};\d{2}|(?:\d+:)?\d{1,2}:\d{2},\d{3})(?=$|[,;\t\s])/)?.[1]
      // "12,48" may be a decimal comma, and a bare number before other numbers or times may be a row number.
      const unclear = /^\d+$/.test(first) && raw.trim().startsWith(first + ',') && (numeric(cells[1]) || cells.slice(1).some(c => c.includes(':') && ![null, +first * 1000].includes(shotTime(c, fps))))
      ms = unclear ? null : shotTime(whole ?? first, fps)
    }
    if (ms === null || !Number.isFinite(ms)) bad.push(i + 1)
    else shots.push(ms)
  })
  return { shots: [...new Set(shots)].sort((a, b) => a - b), bad }
}
