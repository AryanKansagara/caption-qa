import { test } from 'node:test'
import assert from 'node:assert/strict'
import { score, type Issue } from './check.ts'

const cues = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, start: i * 3000, end: i * 3000 + 2000, text: 'Clean line.' }))
const issue = (severity: Issue['severity']): Issue => ({ rule: 'chars', cueId: 'c0', severity, message: '' })

test('only a track without issues scores 100', () => {
  assert.equal(score(cues(300), []), 100)
  for (const n of [201, 300, 5000]) for (const s of ['error', 'warn'] as const) assert.equal(score(cues(n), [issue(s)]), 99, `${s} in ${n}`)
})

test('other scores are still rounded to nearest', () => {
  assert.equal(score(cues(3), [issue('error')]), 67)
  assert.equal(score(cues(1), [issue('error')]), 0)
  assert.equal(score([], []), 0)
})
