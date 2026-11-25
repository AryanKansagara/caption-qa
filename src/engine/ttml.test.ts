import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './parse.ts'

const tt = (body: string, attrs = '') => parse(`<tt xmlns="http://www.w3.org/ns/ttml" ${attrs}>\n<body><div>\n${body}\n</div></body></tt>`)
const cues = (r: ReturnType<typeof parse>) => r.cues.map(c => [c.start, c.end, c.text])

test('frame rate multipliers in TTML and DFXP spelling', () => {
  // 12 frames at 24000/1001 fps last 500.5 ms.
  for (const m of ['1000 1001', '1000:1001']) {
    const r = tt('<p begin="00:00:01:12" end="00:00:03:00">One</p>', `ttp:frameRate="24" ttp:frameRateMultiplier="${m}"`)
    assert.equal(Math.abs(r.cues[0].start - 1500.5) <= 0.5, true)
    assert.equal(r.issues.length, 0)
  }
})

test('unreadable rates and times are errors and never become a cue', () => {
  for (const a of ['ttp:frameRate="abc"', 'ttp:frameRate="0"', 'ttp:frameRateMultiplier="1000 0"', 'ttp:frameRateMultiplier="1000/1001"', 'ttp:frameRate=""']) {
    const r = tt('<p begin="00:00:01:12" end="00:00:03:00">x</p>\n<p begin="4s" end="5s">ok</p>', a)
    assert.deepEqual(cues(r), [[4000, 5000, 'ok']], a)
    assert.deepEqual(r.issues.map(i => i.line), [1, 3], a)
  }
  assert.equal(tt('<p begin="5t" end="9t">x</p>', 'ttp:tickRate="0"').cues.length, 0)
  const r = tt('<p begin="1.2.3s" end="4s">x</p>\n<p begin="5s" dur="..s">x</p>')
  assert.deepEqual([r.cues.length, r.issues.map(i => i.line)], [0, [3, 4]])
})

test('empty paragraphs, comments and single quotes', () => {
  assert.deepEqual(cues(tt('<p/><p begin="1s" end="2s"/><p begin="3s" end="4s">Real</p>')), [[1000, 2000, ''], [3000, 4000, 'Real']])
  const r = tt('<!-- <p begin="1s" end="2s">old</p>\n -->\n<p begin="x" end="4s">Bad</p><p begin=\'3s\' end=\'4s\'>It\'s <!-- note --> fine</p>')
  assert.deepEqual(cues(r).map(c => c[2].toString().replace(/\s+/g, ' ')), ["It's fine"])
  assert.deepEqual(r.issues.map(i => i.line), [5])
})

test('a file cut off before </tt> is reported', () => {
  const r = parse('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="2s">One</p><p begin="3s" end="4s">Tw')
  assert.equal(r.cues.length, 1)
  assert.ok(r.issues.some(i => i.severity === 'error' && /cut off/.test(i.message)))
})
