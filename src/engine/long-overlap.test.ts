import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from './check.ts'
import { autoFix, propose } from './fix.ts'
import { parse } from './parse.ts'
import { PROFILES, rulesFor } from './rules.ts'
import { serialize } from './serialize.ts'
import type { Cue } from './types.ts'

const en = rulesFor(PROFILES[0], 'en')
const ctx = { lang: 'en' }
const cue = (id: string, start: number, end: number, text: string): Cue => ({ id, start, end, text })
const LONG = [cue('a', 1000, 7000, 'Long narration here'), cue('b', 2000, 3000, 'Short one'), cue('c', 4000, 6000, 'Third one'), cue('d', 8000, 9000, 'Fourth one')]
const overlaps = (cues: Cue[]) => check(cues, en, ctx).filter(i => i.rule === 'overlap')

test('a cue that starts before any earlier cue ends is an overlap', () => {
  assert.deepEqual(overlaps(LONG).map(i => [i.cueId, i.message]), [
    ['b', 'Starts 5000 ms before the previous cue ends.'],
    ['c', 'Starts 3000 ms before cue #1 ends.'],
  ])
  // The gap is measured from the cue that is still on screen, not from the one before.
  assert.deepEqual(check([LONG[0], LONG[1], cue('c', 7040, 9000, 'Third one')], en, ctx).filter(i => i.rule === 'gap').map(i => i.message), ['Gap of 1 frames before this cue (min 2).'])
})

test('the import report finds it too, with the line of the long cue', () => {
  const r = parse(serialize(LONG, 'srt'))
  assert.deepEqual(r.issues.map(i => [i.line, i.kind, i.message]), [
    [6, 'overlap', 'Overlaps the previous cue by 5000 ms (starts 00:00:02.000, previous ends 00:00:07.000).'],
    [10, 'overlap', 'Overlaps the cue on line 2 by 3000 ms (starts 00:00:04.000, that cue ends 00:00:07.000).'],
  ])
})

test('cues out of file order are not all called overlaps', () => {
  const kinds = (c: Cue[]) => parse(serialize(c, 'srt')).issues.filter(i => i.kind === 'overlap').map(i => i.line)
  assert.deepEqual(kinds([cue('a', 10000, 12000, 'A'), cue('b', 1000, 2000, 'B'), cue('c', 3000, 4000, 'C')]), [6])
})

test('auto-fix and check agree', () => {
  assert.deepEqual(propose(LONG, en, ctx).filter(c => c.kind === 'overlap').map(c => c.key), ['overlap:a+b'])
  const { cues } = autoFix(LONG, en, ctx)
  assert.deepEqual(overlaps(cues), [])
  // A long cue that cannot be trimmed, and nested pairs.
  for (const c of [
    [cue('a', 0, 7000, 'Long'), cue('b', 500, 1500, 'Two'), cue('c', 2000, 3000, 'Three'), cue('d', 9000, 9900, 'Four')],
    [cue('a', 0, 60000, 'Long'), ...Array.from({ length: 8 }, (_, i) => cue(`n${i}`, 2000 + i * 3000, 4500 + i * 3000, 'Nested'))],
  ]) assert.deepEqual(overlaps(autoFix(c, en, ctx).cues), [])
})

test('no change moves a cue back onto an earlier one that is still on screen', () => {
  // c starts after the long cue, a cut lies inside it, and c is too fast to read.
  const cues = [cue('a', 0, 5000, 'Long narration'), cue('b', 1000, 2000, 'Short'), cue('c', 5100, 6200, 'Much too much text for this time')]
  for (const ch of propose(cues, en, { lang: 'en', shots: [4900] })) for (const c of ch.after) if (c.id === 'c') assert.ok(c.start >= 5000, JSON.stringify(ch))
})
