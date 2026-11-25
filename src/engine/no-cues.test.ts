import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, parseBytes } from './parse.ts'
import type { Format } from './types.ts'

const EMPTY: [Format, string][] = [
  ['srt', ''], ['srt', '\n\n'], ['srt', '﻿'], ['vtt', 'WEBVTT\n'], ['vtt', 'WEBVTT\n\nNOTE only a comment\n'], ['vtt', ''], ['sbv', ''],
  ['ass', ''], ['ass', '[Script Info]\n\n[Events]\nFormat: Layer, Start, End, Text\n'], ['ass', '[Events]\nFormat: Layer, Start, End, Text\nComment: 0,0:00:01.00,0:00:02.00,x\n'],
  ['ttml', ''], ['ttml', '<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>'], ['ttml', '<tt><body><div><p/></div></body></tt>'],
]

test('a file without cues always has an error finding', () => {
  for (const [f, text] of EMPTY) {
    const r = parse(text, f)
    assert.equal(r.cues.length, 0)
    assert.ok(r.issues.some(i => i.severity === 'error'), `${f} ${JSON.stringify(text)}`)
  }
  assert.ok(parseBytes(new Uint8Array(0), 'empty.srt').issues.some(i => i.severity === 'error'))
})

test('a file with cues, or one that already has an error, gets no extra finding', () => {
  assert.deepEqual(parse('1\n00:00:01,000 --> 00:00:02,000\nA\n').issues, [])
  assert.equal(parse('1\n00:00:0X,000 --> 00:00:02,000\nA\n', 'srt').issues.filter(i => i.severity === 'error').length, 1)
})
