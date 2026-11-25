import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './parse.ts'

const read = (...texts: string[]) => parse('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' + texts.map((t, i) => `Dialogue: 0,0:00:0${i + 1}.00,0:00:0${i + 1}.90,D,,0,0,0,,${t}`).join('\n') + '\n', 'ass')
const texts = (...t: string[]) => read(...t).cues.map(c => c.text)
const D = 'm 0 0 l 100 0 100 100 0 100'

test('a line that is only a drawing is not a cue', () => {
  assert.deepEqual(texts(`{\\p1}${D}{\\p0}`, 'Hello', `{\\an7\\pos(10,20)\\p1}${D}`, `{\\p4}${D}`, `{\\i1\\p1}${D}`, `{\\p1}${D}\\N${D}{\\p0} `), ['Hello'])
})

test('text around a drawing stays, the drawing goes', () => {
  assert.deepEqual(texts(`{\\p1}${D}{\\p0}Hello`, `Hi {\\p1}${D}{\\p0}there`, `{\\i1}Yes{\\p2}${D}{\\p0}{\\i0}`), ['Hello', 'Hi there', '<i>Yes</i>'])
})

test('other codes that begin with p are not drawings', () => {
  assert.deepEqual(texts('{\\pos(1,2)}Hello', '{\\pbo5}Hello', '{\\p0}Hello', '{\\p1\\p0}Hello'), ['Hello', 'Hello', 'Hello', 'Hello'])
})

test('an empty line is still an empty cue, and a file of drawings is an error', () => {
  assert.deepEqual(texts('', '{\\i1}{\\i0}', '{\\p1}{\\p0}'), ['', '', ''])
  assert.deepEqual(read(`{\\p1}${D}`).issues.map(i => i.severity), ['error'])
})
