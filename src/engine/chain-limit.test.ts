import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from './check.ts'
import { autoFix, propose } from './fix.ts'
import { PROFILES, rulesFor } from './rules.ts'

const en = rulesFor(PROFILES[0], 'en')
const ctx = { lang: 'en' }
const pair = (end: number, next: number) => [{ id: 'a', start: 0, end, text: 'Hello there everyone in the room' }, { id: 'b', start: next, end: next + 1700, text: 'Bye now' }]

test('a gap is left when closing it would pass the maximum duration', () => {
  const cues = pair(6900, 7300)
  assert.deepEqual(propose(cues, en, ctx).filter(c => c.kind === 'chain'), [])
  assert.deepEqual(autoFix(cues, en, ctx), { cues, applied: [] })
})

test('closing a gap never creates a max-duration problem', () => {
  for (let end = 6400; end <= 7100; end += 20) for (let gap = 60; gap <= 520; gap += 20) {
    const cues = pair(end, end + gap)
    const out = propose(cues, en, ctx).find(c => c.kind === 'chain')?.after ?? []
    assert.ok(!check(out, en, ctx).some(i => i.rule === 'max-duration'), `${end} ${gap}`)
  }
})

test('a gap that fits is still closed', () => {
  assert.equal(propose(pair(6700, 7000), en, ctx).find(c => c.kind === 'chain')!.after[0].end, 6917)
  // Exactly on the limit: 7083 ms minus the two-frame gap of 83 ms.
  assert.equal(propose(pair(6900, 7083), en, ctx).find(c => c.kind === 'chain')!.after[0].end, 7000)
})
