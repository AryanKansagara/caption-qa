import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pairTracks } from './pair-tracks.ts'

const t = (id: string, lang: string, role = 'target') => ({ id, lang, role })
const pairs = (a: ReturnType<typeof t>[], b: ReturnType<typeof t>[]) => pairTracks(a, b).map(p => `${p.key}: ${p.a?.id ?? '-'} ${p.b?.id ?? '-'}`)

test('tracks are matched by id, also when they share a language', () => {
  const all = [t('en', 'en', 'source'), t('full', 'de'), t('forced', 'de')]
  assert.deepEqual(pairs(all, all), ['en: en en', 'full: full full', 'forced: forced forced'])
  assert.deepEqual(pairs(all, [...all].reverse()), ['en: en en', 'full: full full', 'forced: forced forced'])
  // A changed language or role is still the same track.
  assert.deepEqual(pairs([t('x', 'de')], [t('x', 'fr', 'source')]), ['x: x x'])
})

test('language and role are the fallback, and never take a track that has its own match', () => {
  assert.deepEqual(pairs([t('old', 'de')], [t('new', 'de')]), ['old: old new'])
  assert.deepEqual(pairs([t('old', 'de'), t('kept', 'de')], [t('kept', 'de'), t('new', 'de')]), ['old: old new', 'kept: kept kept'])
  assert.deepEqual(pairs([t('a', 'de')], [t('a', 'de'), t('b', 'de')]), ['a: a a', 'b: - b'])
  assert.deepEqual(pairs([t('a', 'de'), t('b', 'es')], []), ['a: a -', 'b: b -'])
})
