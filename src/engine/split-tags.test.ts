import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from './check.ts'
import { propose } from './fix.ts'
import { PROFILES, rulesFor } from './rules.ts'
import { plain } from './text.ts'

const en = rulesFor(PROFILES[0], 'en')
const ctx = { lang: 'en' }
const split = (text: string) => propose([{ id: 'a', start: 0, end: 9000, text }], en, ctx).find(c => c.kind === 'split')?.after.map(c => c.text.replace(/\n/g, ' '))
const A = 'This cue stays on screen far too long.', B = 'Nobody should read one subtitle for so long.'

test('tags open at the cut are closed in the first half and reopened in the second', () => {
  assert.deepEqual(split(`<i>${A} ${B}</i>`), [`<i>${A}</i>`, `<i>${B}</i>`])
  assert.deepEqual(split(`<b><i>${A} ${B}</i></b>`), [`<b><i>${A}</i></b>`, `<b><i>${B}</i></b>`])
  assert.deepEqual(split(`This cue stays on <i>screen far too long. Nobody</i> should read one subtitle for so long.`), ['This cue stays on <i>screen far too long.</i>', '<i>Nobody</i> should read one subtitle for so long.'])
  assert.deepEqual(split(`<font color="red" size="3">${A} ${B}</font>`), [`<font color="red" size="3">${A}</font>`, `<font color="red" size="3">${B}</font>`])
})

test('a tag that ends or starts at the cut leaves no empty pair', () => {
  assert.deepEqual(split(`<i>${A}</i> ${B}`), [`<i>${A}</i>`, B])
  assert.deepEqual(split(`${A} <i>${B}</i>`), [A, `<i>${B}</i>`])
  assert.deepEqual(split(`<i>${A} </i>${B}`), [`<i>${A}</i>`, B])
})

test('untagged text splits as before, and an unbalanced cue gets no new tag errors', () => {
  assert.deepEqual(split(`${A} ${B}`), [A, B])
  assert.deepEqual(split(`<i>${A} ${B}`), [`<i>${A}</i>`, `<i>${B}`])
  assert.deepEqual(split(`${A}</i> ${B}`), [`${A}</i>`, B])
})

test('a split never changes the visible words or adds a tag error', () => {
  const words = `${A} ${B}`.split(' ')
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j <= words.length; j++) {
    const text = [...words.slice(0, i), `<i>${words.slice(i, j).join(' ')}</i>`, ...words.slice(j)].join(' ')
    const ch = propose([{ id: 'a', start: 0, end: 9000, text }], en, ctx).find(c => c.kind === 'split')!
    assert.equal(plain(ch.after.map(c => c.text).join(' ')).replace(/\s+/g, ' '), `${A} ${B}`)
    assert.deepEqual(check(ch.after, en, ctx).filter(x => x.rule === 'tags'), [], text)
  }
})
