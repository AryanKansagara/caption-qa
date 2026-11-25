import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resync } from './fix.ts'

const cues = [{ id: 'a', start: 1000, end: 2000, text: 'One' }, { id: 'b', start: 11000, end: 12000, text: 'Two' }]

test('points that run time backwards or collapse it are refused', () => {
  assert.throws(() => resync(cues, 1000, 12000, 11000, 2000), /backwards/)
  assert.throws(() => resync(cues, 11000, 2000, 1000, 12000), /backwards/)
  assert.throws(() => resync(cues, 1000, 5000, 11000, 5000), /must be different/)
  assert.throws(() => resync(cues, 1000, 5000, 1000, 6000), /different times/)
})

test('a forward stretch works in either order of the points', () => {
  const want = [[1500, 2600], [12500, 13600]]
  assert.deepEqual(resync(cues, 1000, 1500, 11000, 12500).map(c => [c.start, c.end]), want)
  assert.deepEqual(resync(cues, 11000, 12500, 1000, 1500).map(c => [c.start, c.end]), want)
})
