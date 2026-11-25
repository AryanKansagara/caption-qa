import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingNumbers } from './check.ts'

test('two numbers next to each other stay two numbers', () => {
  assert.deepEqual(missingNumbers('In 2009 100 people came', 'En 2009, 100 personas vinieron'), [])
  assert.deepEqual(missingNumbers('It needs 36\n100 people came', 'Necesita 36. Vinieron 100 personas'), [])
  assert.deepEqual(missingNumbers('In 2009 100 people came', 'En 2009, 101 personas vinieron'), ['100'])
})

test('digits next to each other may be read either way', () => {
  for (const [a, b] of [['36\n100', '36 100'], ['36 100', '36\n100'], ['36 100', '36, 100'], ['At 36, 100 came', '36 100 vinieron']]) assert.deepEqual(missingNumbers(a, b), [], `${a} | ${b}`)
})

test('thousands separators and decimals still match', () => {
  for (const [a, b] of [['1 250', '1,250'], ['1,250', '1.250'], ['1 250', '1 250'], ['12 345 678', '12.345.678'], ['1,250.5', '1 250,5'], ['3.5', '3,5'], ['2009', '2009'], ['1250', '1 250']]) {
    assert.deepEqual(missingNumbers(a, b), [], `${a} | ${b}`)
    assert.deepEqual(missingNumbers(b, a), [], `${b} | ${a}`)
  }
})

test('a changed or lost number is still found', () => {
  assert.deepEqual(missingNumbers('1,250 loaves', '1.520 panes'), ['1250'])
  assert.deepEqual(missingNumbers('1 250 loaves', '1 520 panes'), ['1250'])
  assert.deepEqual(missingNumbers('36 100 people', '36 personas'), ['36100'])
  assert.deepEqual(missingNumbers('27 layers, 27 times', '27 capas'), ['27'])
  assert.deepEqual(missingNumbers('1.2505 m', '1.250 m'), ['1.2505'])
})
