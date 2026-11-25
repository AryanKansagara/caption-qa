import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoFix, propose } from './fix.ts'
import { PROFILES, rulesFor, type Rules } from './rules.ts'
import type { Cue } from './types.ts'

const en = rulesFor(PROFILES[0], 'en')
const cue = (id: string, start: number, end: number, text: string): Cue => ({ id, start, end, text })
const bad = (cues: Cue[]) => cues.filter(c => c.end <= c.start)

test('the minimum gap is not made out of a cue that is shorter than it', () => {
  const l = 'Aaaa bbbb cccc dddd eeee ffff gggg hhhh i'
  const cues = [cue('a', 0, 990, 'Some text here'), cue('b', 1000, 1050, 'Short but with quite a lot of words here'), cue('c', 1060, 3000, `${l}\n${l}`)]
  assert.ok(!propose(cues, en, { lang: 'en' }).some(c => bad(c.after).length))
  assert.deepEqual(bad(autoFix(cues, en, { lang: 'en' }).cues), [])
})

test('a cue shorter than the gap is not split', () => {
  const ch = propose([cue('a', 0, 60, `${'Far too much text for one subtitle. '.repeat(4)}`)], en, { lang: 'en' })
  assert.deepEqual(ch.filter(c => c.kind === 'split'), [])
})

test('a cue delivered without duration gets no worse', () => {
  const out = autoFix([cue('a', 1000, 1000, 'One'), cue('b', 1000, 3000, 'Two')], en, { lang: 'en' }).cues
  assert.ok(out.every(c => c.end >= c.start), JSON.stringify(out))
})

test('random tracks: auto-fix never creates a cue without duration', () => {
  let seed = 7
  const rnd = (n: number) => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) % n }
  const words = 'a of the bread oven morning, flour. water! rises slowly'.split(' ')
  for (let k = 0; k < 400; k++) {
    let t = 0
    const cues = Array.from({ length: 2 + rnd(6) }, (_, i) => {
      t += rnd(1500)
      return cue(`c${i}`, t, t + 1 + rnd(k % 2 ? 300 : 9000), Array.from({ length: 1 + rnd(25) }, () => words[rnd(words.length)]).join(' '))
    })
    const shots = k % 3 ? [] : [rnd(3000), 3000 + rnd(3000)]
    const r: Rules = k % 5 ? en : { ...en, minDurationMs: 0, maxCps: 0 }
    assert.deepEqual(bad(autoFix(cues, r, { lang: 'en', shots }).cues), [], JSON.stringify({ k, cues, shots }))
  }
})
