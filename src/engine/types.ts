/** Times are integer milliseconds. Text uses "\n" between lines and keeps <i>, <b>, <u> tags. */
export interface Cue {
  id: string
  start: number
  end: number
  text: string
}

export type Format = 'srt' | 'vtt' | 'ass' | 'ttml' | 'sbv'

export interface ParseIssue {
  line: number
  kind: 'timecode' | 'overlap' | 'negative' | 'numbering' | 'empty' | 'format' | 'encoding'
  severity: 'error' | 'warn'
  message: string
}

export interface ParseResult {
  format: Format
  cues: Cue[]
  issues: ParseIssue[]
  encoding?: string
  frameRate?: number
}

export const FORMAT_LABEL: Record<Format, string> = { srt: 'SubRip (.srt)', vtt: 'WebVTT (.vtt)', ass: 'ASS/SSA (.ass)', ttml: 'TTML/DFXP (.ttml)', sbv: 'YouTube SBV (.sbv)' }
export const FORMAT_EXT: Record<Format, string> = { srt: 'srt', vtt: 'vtt', ass: 'ass', ttml: 'ttml', sbv: 'sbv' }
