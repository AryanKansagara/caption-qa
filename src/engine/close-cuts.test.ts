import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from './check.ts'
import { autoFix, propose } from './fix.ts'
import { PROFILES, rulesFor } from './rules.ts'

const en = rulesFor(PROFILES[0], 'en')
const cue = (start: number, end: number) => [{ id: 'a', start, end, text: 'On the cut here' }]
const found = (start: number, end: number, shots: number[]) => check(cue(start, end), en, { lang: 'en', shots }).filter(i => i.rule === 'shot-change').map(i => i.message)
const snaps = (start: number, end: number, shots: number[]) => propose(cue(start, end), en, { lang: 'en', shots }).filter(c => c.kind === 'snap').map(c => [c.after[0].start, c.after[0].end])

test('a boundary on a cut is never flagged or moved', () => {
  // Two frames before the cut, and on it, are both fine for an out-time.
  for (const [s, e, shots] of [[5000, 7000, [5000, 5250]], [5250, 7000, [5000, 5250]], [5000, 6917, [4800, 5000, 5250, 7000, 7250]], [5000, 7000, [5000, 6700, 7000]]] as [number, number, number[]][]) {
    assert.deepEqual(found(s, e, shots), [], `${s} ${e}`)
    assert.deepEqual(snaps(s, e, shots), [], `${s} ${e}`)
    assert.deepEqual(autoFix(cue(s, e), en, { lang: 'en', shots }).applied, [])
  }
})

test('otherwise the nearest cut is used', () => {
  assert.deepEqual(found(5200, 8000, [5000, 5250]), ['Starts 1 frames before a shot change; snap it to the cut.'])
  assert.deepEqual(snaps(5200, 8000, [5000, 5250]), [[5250, 8000]])
  assert.deepEqual(found(5000, 7300, [5000, 7000, 7450]), ['Ends 4 frames before a shot change; end 2 frames before the cut.'])
  assert.deepEqual(snaps(5000, 7300, [5000, 7000, 7450]), [[5000, 7367]])
})

test('auto-fix is stable for any two close cuts', () => {
  for (let a = 4600; a <= 5400; a += 50) for (let b = a + 50; b <= a + 450; b += 100) {
    const ctx = { lang: 'en', shots: [a, b, a + 2000, b + 2000] }
    const once = autoFix(cue(5000, 7000), en, ctx)
    assert.deepEqual(autoFix(once.cues, en, ctx).applied, [], JSON.stringify(ctx.shots))
    assert.ok(once.applied.length <= 2, JSON.stringify(ctx.shots))
  }
})
