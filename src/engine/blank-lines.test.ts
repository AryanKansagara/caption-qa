import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './parse.ts'

const cues = (s: string) => parse(s).cues.map(c => [c.start, c.end, c.text])

test('SRT: a missing blank line starts a new cue and is reported', () => {
  const r = parse('1\n00:00:01,000 --> 00:00:02,000\nHello\n2\n00:00:03,000 --> 00:00:04,000\nBye\n\n3\n00:00:05,000 --> 00:00:06,000\nEnd\n')
  assert.deepEqual(r.cues.map(c => [c.start, c.text]), [[1000, 'Hello'], [3000, 'Bye'], [5000, 'End']])
  assert.deepEqual(r.issues.map(i => [i.line, i.kind]), [[4, 'format']])
  assert.deepEqual(cues('00:00:01,000 --> 00:00:02,000\nA\n00:00:03,000 --> 00:00:04,000\nB'), [[1000, 2000, 'A'], [3000, 4000, 'B']])
})

test('SRT: an unreadable timecode after a missing blank line is an error, not text', () => {
  const r = parse('1\n00:00:01,000 --> 00:00:02,000\nHello\n2\n00:00:0X,000 --> 00:00:04,000\nBye\n')
  assert.deepEqual(r.cues.map(c => c.text), ['Hello'])
  assert.ok(r.issues.some(i => i.line === 5 && i.severity === 'error'))
  const f = parse('1\n00:00:0X,000 --> 00:00:02,000\nLost\n2\n00:00:03,000 --> 00:00:04,000\nBye\n')
  assert.deepEqual(f.cues.map(c => c.text), ['Bye'])
  assert.ok(f.issues.some(i => i.line === 2 && i.severity === 'error'))
})

test('SRT: an arrow or a number in the text stays text', () => {
  for (const t of ['Go A --> B', '1 --> 2', '5:30 --> 6:00?', '10\n20', 'Section 5:\n-->']) assert.deepEqual(cues(`1\n00:00:01,000 --> 00:00:02,000\n${t}\n`), [[1000, 2000, t]])
})

test('WebVTT: a cue right after the header, and cues without a blank line', () => {
  const r = parse('WEBVTT\nKind: captions\n00:01.000 --> 00:02.000\nHi\n\n00:03.000 --> 00:04.000\nBye\n00:05.000 --> 00:06.000\nEnd')
  assert.deepEqual(r.cues.map(c => [c.start, c.text]), [[1000, 'Hi'], [3000, 'Bye'], [5000, 'End']])
  assert.deepEqual(r.issues.map(i => i.line), [3, 8])
})

test('WebVTT: identifiers may begin with NOTE; comments, STYLE and REGION blocks are skipped', () => {
  const r = parse('WEBVTT\n\nNOTE a comment\nover two lines\n\nSTYLE\n::cue { color: red }\n\nREGION\nid:a\n\nNOTE-1\n00:01.000 --> 00:02.000\nHi\n')
  assert.deepEqual(r.cues.map(c => [c.start, c.text]), [[1000, 'Hi']])
  assert.deepEqual(r.issues, [])
})
