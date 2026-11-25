import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from './check.ts'
import { parse } from './parse.ts'
import { PROFILES, rulesFor } from './rules.ts'
import { serialize } from './serialize.ts'
import { lineChars, plain } from './text.ts'
import type { Format } from './types.ts'

const fr = rulesFor(PROFILES[0], 'fr')
const cue = (text: string) => [{ id: 'c1', start: 1000, end: 3000, text }]
const LITERAL = ['<<Bonjour>> dit-il', 'a < b and b > c', 'I <3 you', 'a <b and c> d', 'x<y>z', '<Bonjour>', 'Tom & Jerry &lt;3 &amp;', '<i', '1 --> 2', '<>']

test('only subtitle tags are stripped and counted as tags', () => {
  for (const t of LITERAL) {
    assert.equal(plain(t), t)
    assert.ok(!check(cue(t), fr, { lang: 'fr' }).some(i => i.rule === 'tags'), t)
  }
  assert.equal(lineChars('<<Bonjour>> dit-il'), 18)
  assert.equal(plain('<i>a</i><b.x>b</B><u >c</u><font color="#00f" size=2>d</font><v.loud Ann Lee>e</v><c.yellow>f</c><lang en>g</lang><00:01.000>h<01:00:01.000>i<br/>j<img src=x onerror=a(1)>'), 'abcdefghij')
  assert.match(check(cue('<blink>x</blink>'), fr, { lang: 'fr' }).find(i => i.rule === 'tags')!.message, /<\/blink>/)
  assert.match(check(cue('<b>x</b>'), fr, { lang: 'fr' })[0].message, /Tag <b>/)
})

test('text in angle brackets survives every export', () => {
  for (const f of ['srt', 'vtt', 'ass', 'ttml', 'sbv'] as Format[]) {
    for (const t of LITERAL) assert.equal(parse(serialize(cue(t), f), f).cues[0].text, t, `${f}: ${t}`)
  }
})

test('WebVTT export escapes text and keeps tags', () => {
  const out = serialize(cue('<i>Salt & pepper</i> <3\na -> b'), 'vtt')
  assert.ok(out.includes('<i>Salt &amp; pepper</i> &lt;3\na -&gt; b\n'), out)
  assert.equal(parse(out).cues[0].text, '<i>Salt & pepper</i> <3\na -> b')
})
