import { fmtTime } from './parse.ts'
import type { Cue, Format } from './types.ts'

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '')
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function assClock(ms: number) {
  const cs = Math.round(Math.max(0, ms) / 10)
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

function sbvClock(ms: number) {
  const t = fmtTime(ms)
  return t.replace(/^0(\d:)/, '$1')
}

export function serialize(cues: Cue[], format: Format, opts: { lang?: string; title?: string } = {}): string {
  switch (format) {
    case 'srt':
      return cues.map((c, i) => `${i + 1}\n${fmtTime(c.start, ',')} --> ${fmtTime(c.end, ',')}\n${c.text}\n`).join('\n')
    case 'vtt':
      return 'WEBVTT\n\n' + cues.map(c => `${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}\n`).join('\n')
    case 'sbv':
      return cues.map(c => `${sbvClock(c.start)},${sbvClock(c.end)}\n${stripTags(c.text)}\n`).join('\n')
    case 'ass': {
      const head = `[Script Info]\nTitle: ${opts.title ?? 'Caption QA export'}\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,0,2,60,60,50,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
      const body = cues.map(c => {
        const t = c.text.replace(/<i>/g, '{\\i1}').replace(/<\/i>/g, '{\\i0}').replace(/<b>/g, '{\\b1}').replace(/<\/b>/g, '{\\b0}').replace(/<[^>]+>/g, '').replace(/\n/g, '\\N')
        return `Dialogue: 0,${assClock(c.start)},${assClock(c.end)},Default,,0,0,0,,${t}`
      }).join('\n')
      return head + body + '\n'
    }
    case 'ttml': {
      const ps = cues.map(c => {
        const inner = c.text.split('\n').map(l => xmlEscape(l).replace(/&lt;i&gt;/g, '<span tts:fontStyle="italic">').replace(/&lt;\/i&gt;/g, '</span>').replace(/&lt;\/?[bu]&gt;/g, '')).join('<br/>')
        return `      <p begin="${fmtTime(c.start)}" end="${fmtTime(c.end)}">${inner}</p>`
      }).join('\n')
      return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="${opts.lang ?? 'en'}">\n  <body>\n    <div>\n${ps}\n    </div>\n  </body>\n</tt>\n`
    }
  }
}
