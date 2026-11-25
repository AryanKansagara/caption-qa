import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from './csv.ts'

test('cells that a spreadsheet would run as a formula become text', () => {
  for (const t of ['=1+1', '+1', '-Good morning', '@SUM(A1)', '\tx', '\rx']) assert.match(toCsv([[t]]), /^"?'/, t)
  assert.equal(toCsv([['=HYPERLINK("http://x.test";"a")', 'ok']]), `"'=HYPERLINK(""http://x.test"";""a"")",ok\n`)
})

test('cells are quoted when needed and otherwise unchanged', () => {
  assert.equal(toCsv([['a, b', 'say "hi"', 'two\nlines', 'cr\rhere', 'plain', '', '00:00:01.000', 'a-b = c']]), '"a, b","say ""hi""","two\nlines","cr\rhere",plain,,00:00:01.000,a-b = c\n')
})
