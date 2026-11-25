import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './parse.ts'
import { serialize } from './serialize.ts'
import type { Format } from './types.ts'

const cues = (...texts: string[]) => texts.map((text, i) => ({ id: `c${i + 1}`, start: 1000 + i * 3000, end: 3000 + i * 3000, text }))

test('an empty line inside a cue does not end the exported cue', () => {
  for (const f of ['srt', 'vtt', 'sbv'] as Format[]) {
    for (const t of ['One\n\nTwo', 'One\n \n\t\n\u00a0\nTwo', '\nOne\nTwo\n\n', 'One\r\n\r\nTwo', 'One\r\rTwo']) {
      const r = parse(serialize(cues(t, 'After'), f), f)
      assert.deepEqual(r.cues.map(c => c.text), ['One\nTwo', 'After'], `${f}: ${JSON.stringify(t)}`)
      assert.deepEqual(r.issues, [])
    }
  }
})

test('SBV: a line that held only a tag does not become an empty line', () => {
  assert.deepEqual(parse(serialize(cues('<i>\nOne\n</i>\nTwo', 'After'), 'sbv')).cues.map(c => c.text), ['One\nTwo', 'After'])
})

test('ASS and TTML, which have no such limit, keep the empty line', () => {
  for (const f of ['ass', 'ttml'] as Format[]) assert.equal(parse(serialize(cues('One\n\nTwo'), f), f).cues[0].text, 'One\n\nTwo')
})

test('a cue without text stays one cue', () => {
  for (const f of ['srt', 'vtt', 'sbv'] as Format[]) assert.deepEqual(parse(serialize(cues('', '\n\n', 'After'), f), f).cues.map(c => c.text), ['', '', 'After'])
})
