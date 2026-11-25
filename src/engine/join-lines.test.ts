import { test } from 'node:test'
import assert from 'node:assert/strict'
import { breakProblem, rebreak } from './text.ts'

test('Korean keeps the space a line break stands for', () => {
  assert.equal(rebreak('안녕하세요\n여러분', 16, 'ko', true), '안녕하세요 여러분')
  assert.equal(rebreak('<i>안녕하세요\n여러분</i>', 16, 'ko-KR', true), '<i>안녕하세요 여러분</i>')
})

test('Chinese and Japanese join without a space, except between Latin words', () => {
  assert.equal(rebreak('我喜欢 Rock\nand Roll', 20, 'zh'), '我喜欢 Rock and Roll')
  assert.equal(rebreak('你好…\n世界', 16, 'zh'), '你好…世界')
  assert.equal(rebreak('今日は、\n元気です', 13, 'ja'), '今日は、元気です')
  assert.equal(rebreak('私の\nCD', 13, 'ja'), '私のCD')
  assert.equal(rebreak('𠮷野\n家', 13, 'ja'), '𠮷野家')
})

test('the fits-on-one-line check measures the joined text', () => {
  // 8 + 8 = 16 characters joined.
  assert.equal(breakProblem('我们每天喂两次酵\n种然后等五个小时', 16, 2, 'zh'), 'one-line')
  // Korean: 8 + 1 space (half) + 8 is over 16.
  assert.equal(breakProblem('가나다라마바사아\n자차카타파하가나', 16, 2, 'ko', true), null)
})
