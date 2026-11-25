import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './parse.ts'
import { serialize } from './serialize.ts'

const cue = (text: string) => [{ id: 'c1', start: 1000, end: 3000, text }]
const body = (text: string) => serialize(cue(text), 'ttml').match(/<p [^>]*>([\s\S]*)<\/p>/)![1]
const span = (t: string) => `<span tts:fontStyle="italic">${t}</span>`

test('unbalanced italics are closed at the end of the cue', () => {
  assert.equal(body('<i>Open italics'), span('Open italics'))
  assert.equal(body('Stray</i> close'), 'Stray close')
  assert.equal(body('<i>a</i></i> b <i>c'), `${span('a')} b ${span('c')}`)
  assert.equal(body('<i>a <i>b</i> c</i> d'), `${span('a b c')} d`)
  assert.equal(body('a<i/> b'), 'a b')
  assert.equal(body('<i>a</i>\n<I >b'), `${span('a')}<br/>${span('b')}`)
})

test('characters XML cannot hold are dropped, other text is escaped', () => {
  assert.equal(body('a\u0000b\u0008c\u000bd\u000ce\u001ff\ufffeg\uffffh'), 'abcdefgh')
  assert.equal(body('lone \ud800 half, 😀 whole'), 'lone  half, 😀 whole')
  assert.equal(body('a\tb\r\nc\rd'), 'a\tb<br/>c<br/>d')
  assert.equal(body('<<Bonjour>> & a < b'), '&lt;&lt;Bonjour&gt;&gt; &amp; a &lt; b')
  assert.equal(body('<b>bold</b> <u>line</u> <font color="red">red</font>'), 'bold line red')
})

test('balanced cues read back the same', () => {
  for (const t of ['<i>Hello\nthere</i>', 'One <i>two</i> three', 'Salt & pepper', '<i>a</i>\n<i>b</i>']) assert.equal(parse(serialize(cue(t), 'ttml')).cues[0].text, t)
})
