import type { Cue, Format, ParseIssue, ParseResult } from './types.ts'

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
  if (/<tt[\s>]/.test(head) || /<\?xml/.test(head) && /<tt|<p\s/.test(text.slice(0, 6000))) return 'ttml'
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

/** Overlap and negative-duration checks shared by every format. `lineOf` maps cue index to its source line. */
export function validateTiming(cues: Cue[], lineOf: number[]): ParseIssue[] {
  const out: ParseIssue[] = []
  cues.forEach((c, i) => {
    const line = lineOf[i] ?? 0
    if (c.end <= c.start) out.push({ line, kind: 'negative', severity: 'error', message: c.end === c.start ? 'Zero-length cue: end time equals start time.' : `End time is before start time (${fmtTime(c.end)} < ${fmtTime(c.start)}).` })
    const prev = cues[i - 1]
    if (prev && c.start < prev.end) out.push({ line, kind: 'overlap', severity: 'error', message: `Overlaps the previous cue by ${prev.end - c.start} ms (starts ${fmtTime(c.start)}, previous ends ${fmtTime(prev.end)}).` })
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

function parseArrowBlocks(text: string, vtt: boolean): { cues: Cue[]; lineOf: number[]; issues: ParseIssue[] } {
  const L = lines(text)
  const cues: Cue[] = [], lineOf: number[] = [], issues: ParseIssue[] = []
  let i = 0
  if (vtt) {
    if (!/^WEBVTT/.test(L[0] ?? '')) issues.push({ line: 1, kind: 'format', severity: 'error', message: 'WebVTT files must start with "WEBVTT".' })
    while (i < L.length && L[i].trim() !== '') i++
  }
  let expectNum = 1
  while (i < L.length) {
    while (i < L.length && L[i].trim() === '') i++
    if (i >= L.length) break
    const blockStart = i
    const block: string[] = []
    while (i < L.length && L[i].trim() !== '') block.push(L[i++])
    if (vtt && /^(NOTE|STYLE|REGION)\b/.test(block[0])) continue
    const k = block.findIndex(l => l.includes('-->'))
    if (k < 0) {
      issues.push({ line: blockStart + 1, kind: 'timecode', severity: 'error', message: `No timecode line found in this block ("${block[0].slice(0, 40)}"). Block skipped.` })
      continue
    }
    if (!vtt) {
      const num = block[0].trim()
      if (k === 0) issues.push({ line: blockStart + 1, kind: 'numbering', severity: 'warn', message: 'Cue number missing before the timecode.' })
      else if (!/^\d+$/.test(num)) issues.push({ line: blockStart + 1, kind: 'numbering', severity: 'warn', message: `Cue number "${num.slice(0, 20)}" is not a number.` })
      else if (+num !== expectNum) issues.push({ line: blockStart + 1, kind: 'numbering', severity: 'warn', message: `Numbering jumps: expected ${expectNum}, found ${num}.` })
      if (/^\d+$/.test(num)) expectNum = +num + 1
      else expectNum++
    }
    const m = block[k].match(ARROW)
    const lineNo = blockStart + k + 1
    if (!m) {
      issues.push({ line: lineNo, kind: 'timecode', severity: 'error', message: `Unreadable timecode "${block[k].trim().slice(0, 60)}". Cue skipped.` })
      continue
    }
    const start = parseClock(m[1]), end = parseClock(m[2])
    if (start === null || end === null) {
      issues.push({ line: lineNo, kind: 'timecode', severity: 'error', message: `Invalid time value in "${block[k].trim()}". Cue skipped.` })
      continue
    }
    if (!vtt && m[1].includes('.')) issues.push({ line: lineNo, kind: 'timecode', severity: 'warn', message: 'SRT timecodes should use a comma before milliseconds.' })
    let body = block.slice(k + 1).join('\n')
    if (vtt) body = body.replace(/<(\/?)(c|v|lang|ruby|rt)(\.[^>\s]*)?(\s[^>]*)?>/g, '').replace(/<\d+:\d{2}[:.][\d.:]+>/g, '')
    body = body.replace(/<font[^>]*>|<\/font>/gi, '').replace(/\{\\an\d\}/g, '')
    cues.push({ id: '', start, end, text: body.trim() })
    lineOf.push(lineNo)
  }
  return { cues, lineOf, issues }
}

// ---------- ASS / SSA ----------

function assTime(s: string) { return parseClock(s) }

function assText(t: string) {
  let out = '', italic = false
  for (const part of t.split(/(\{[^}]*\})/)) {
    if (part.startsWith('{')) {
      const im = part.match(/\\i([01])/)
      if (im) {
        if (im[1] === '1' && !italic) { out += '<i>'; italic = true }
        if (im[1] === '0' && italic) { out += '</i>'; italic = false }
      }
      continue
    }
    out += part.replace(/\\N/gi, '\n').replace(/\\h/g, ' ')
  }
  if (italic) out += '</i>'
  return out.replace(/<i>(\s*)<\/i>/g, '$1').trim()
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
    cues.push({ id: '', start, end, text: assText(get('text')) })
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
  m = s.match(/^([\d.]+)(h|m|s|ms|f|t)$/)
  if (m) {
    const v = +m[1]
    const mult: Record<string, number> = { h: 3600000, m: 60000, s: 1000, ms: 1, f: 1000 / fps, t: 1000 / tickRate }
    return Math.round(v * mult[m[2]])
  }
  return null
}

const xmlUnescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&')

function parseTtml(text: string) {
  const cues: Cue[] = [], lineOf: number[] = [], issues: ParseIssue[] = []
  const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*"([^"]*)"`))?.[1]
  const tt = text.match(/<tt[\s>][^>]*>/)?.[0] ?? ''
  const fps = +(attr(tt, 'frameRate') ?? 30) * (attr(tt, 'frameRateMultiplier')?.split(' ').map(Number).reduce((a, b) => a / b) ?? 1)
  const tickRate = +(attr(tt, 'tickRate') ?? 10000000)
  const lineStarts: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineAt = (pos: number) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1 } return lo + 1 }
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const line = lineAt(m.index)
    const b = attr(m[1], 'begin'), e = attr(m[1], 'end'), d = attr(m[1], 'dur')
    const start = b ? ttmlTime(b, fps, tickRate) : null
    let end = e ? ttmlTime(e, fps, tickRate) : null
    if (end === null && d && start !== null) { const dd = ttmlTime(d, fps, tickRate); end = dd === null ? null : start + dd }
    if (start === null || end === null) {
      issues.push({ line, kind: 'timecode', severity: 'error', message: `Missing or unreadable begin/end on <p> (begin="${b ?? ''}", end="${e ?? d ?? ''}"). Cue skipped.` })
      continue
    }
    const body = m[2]
      .replace(/\s*\n\s*/g, ' ')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<span\b[^>]*fontStyle\s*=\s*"italic"[^>]*>([\s\S]*?)<\/span>/g, '<i>$1</i>')
      .replace(/<(?!\/?i>)[^>]+>/g, '')
    cues.push({ id: '', start, end, text: xmlUnescape(body).split('\n').map(s => s.trim()).join('\n').trim() })
    lineOf.push(line)
  }
  if (!cues.length && !issues.length) issues.push({ line: 1, kind: 'format', severity: 'error', message: 'No <p begin=".." end=".."> elements found.' })
  return { cues, lineOf, issues, frameRate: fps }
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

/** Shot list: one cut per line as seconds (12.48), a clock (00:00:12.480) or SMPTE timecode (00:00:12:12, frames at `fps`). CSV rows use the first column. */
export function parseShotList(text: string, fps = 24): { shots: number[]; bad: number[] } {
  const shots: number[] = [], bad: number[] = []
  lines(text).forEach((raw, i) => {
    const v = raw.split(/[,;\t]/)[0].trim()
    if (!v || /^[a-z#]/i.test(v)) return
    const smpte = v.match(/^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{1,2})$/)
    const ms = smpte ? ((+smpte[1] * 60 + +smpte[2]) * 60 + +smpte[3]) * 1000 + Math.round(+smpte[4] * 1000 / fps)
      : /^\d+(\.\d+)?$/.test(v) ? Math.round(+v * 1000)
      : parseClock(v)
    if (ms === null || !Number.isFinite(ms)) bad.push(i + 1)
    else shots.push(ms)
  })
  return { shots: [...new Set(shots)].sort((a, b) => a - b), bad }
}
