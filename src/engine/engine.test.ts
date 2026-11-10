import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decode, detectFormat, parse, parseBytes, parseClock, parseShotList } from './parse.ts'
import { serialize } from './serialize.ts'
import { align, check, expansion, namesIn, score, summarize } from './check.ts'
import { applyChange, autoFix, convertFps, FPS, needMs, propose, resync, shift } from './fix.ts'
import { customFrom, PROFILES, rulesFor } from './rules.ts'
import { cps, lineChars, rebreak, weakEnd, wordCount } from './text.ts'
import { SAMPLE_FILES, SAMPLE_SHOTS } from './sample.ts'
import type { Cue } from './types.ts'

const NF = PROFILES.find(p => p.id === 'netflix')!
const en = rulesFor(NF, 'en')
const cue = (id: string, start: number, end: number, text: string): Cue => ({ id, start, end, text })
const rules = (issues: { rule: string }[]) => issues.map(i => i.rule)

// ---------- Parsing ----------

test('parses SRT with comma milliseconds and multi-line text', () => {
  const r = parse('1\n00:00:01,000 --> 00:00:02,500\nHello\nthere\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n')
  assert.equal(r.format, 'srt')
  assert.deepEqual(r.cues.map(c => [c.start, c.end, c.text]), [[1000, 2500, 'Hello\nthere'], [3000, 4000, 'Bye']])
  assert.equal(r.issues.length, 0)
})

test('SRT validation reports bad timecodes, broken numbering, negative durations and overlaps with line numbers', () => {
  const r = parse('1\n00:00:01,000 --> 00:00:03,000\nA\n\n3\n00:00:02,000 --> 00:00:04,000\nB\n\n4\n00:00:0X,000 --> 00:00:05,000\nC\n\n5\n00:00:08,000 --> 00:00:07,000\nD\n')
  const by = (k: string) => r.issues.filter(i => i.kind === k).map(i => i.line)
  assert.deepEqual(by('numbering'), [5])
  assert.deepEqual(by('overlap'), [6])
  assert.deepEqual(by('timecode'), [10])
  assert.deepEqual(by('negative'), [14])
  assert.equal(r.cues.length, 3)
})

test('parses WebVTT, skipping NOTE blocks, cue ids, settings and voice tags', () => {
  const r = parse('WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.000 align:start line:90%\n<v Priya>Hi</v> <i>there</i>\n\n01:00:00.500 --> 01:00:01.000\nLate\n')
  assert.equal(r.format, 'vtt')
  assert.deepEqual(r.cues.map(c => [c.start, c.text]), [[1000, 'Hi <i>there</i>'], [3600500, 'Late']])
})

test('parses ASS dialogue with \\N breaks, italics override tags and commas in text', () => {
  const ass = '[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hello,{\\i0} world\\Nsecond line\nComment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,ignored\n'
  const r = parse(ass)
  assert.equal(r.format, 'ass')
  assert.equal(r.cues.length, 1)
  assert.deepEqual([r.cues[0].start, r.cues[0].end, r.cues[0].text], [1500, 3000, '<i>Hello,</i> world\nsecond line'])
})

test('parses TTML with clock, offset and frame-based times and <br/>', () => {
  const x = '<?xml version="1.0"?>\n<tt xmlns="http://www.w3.org/ns/ttml" ttp:frameRate="25">\n<body><div>\n<p begin="00:00:01.000" end="00:00:02.000">One<br/>Two</p>\n<p begin="3s" dur="1500ms">Three &amp; <span tts:fontStyle="italic">four</span></p>\n<p begin="00:00:05:10" end="00:00:06:00">Five</p>\n</div></body></tt>'
  const r = parse(x)
  assert.equal(r.format, 'ttml')
  assert.deepEqual(r.cues.map(c => [c.start, c.end, c.text]), [[1000, 2000, 'One\nTwo'], [3000, 4500, 'Three & <i>four</i>'], [5400, 6000, 'Five']])
})

test('parses YouTube SBV', () => {
  const r = parse('0:00:01.000,0:00:02.500\nHello\n\n0:00:03.000,0:00:04.000\nBye\n', null, 'x.sbv')
  assert.equal(r.format, 'sbv')
  assert.deepEqual(r.cues.map(c => c.end), [2500, 4000])
})

test('detects formats from content before falling back to the extension', () => {
  assert.equal(detectFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nx', 'a.srt'), 'vtt')
  assert.equal(detectFormat('[Script Info]\nTitle: a', 'a.txt'), 'ass')
  assert.equal(detectFormat('1\n00:00:01,000 --> 00:00:02,000\nx', 'a.txt'), 'srt')
  assert.equal(detectFormat('garbage', 'a.dfxp'), 'ttml')
})

test('decodes UTF-8 BOM, UTF-16 LE with and without BOM, and falls back to Windows-1252', () => {
  const s = '1\n00:00:01,000 --> 00:00:02,000\nCafé\n'
  const utf8 = new TextEncoder().encode(s)
  assert.equal(decode(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])).encoding, 'UTF-8 (BOM)')
  const le = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) { le[i * 2] = s.charCodeAt(i) & 255; le[i * 2 + 1] = s.charCodeAt(i) >> 8 }
  assert.equal(decode(new Uint8Array([0xff, 0xfe, ...le])).text, s)
  assert.equal(decode(le).encoding, 'UTF-16 LE')
  const cp1252 = new Uint8Array([...new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nCaf'), 0xe9, 10])
  const r = parseBytes(cp1252, 'a.srt')
  assert.equal(r.encoding, 'Windows-1252')
  assert.equal(r.cues[0].text, 'Café')
  assert.ok(r.issues.some(i => i.kind === 'encoding'))
})

test('clock parser rejects out-of-range minutes and pads fractional parts', () => {
  assert.equal(parseClock('00:61:00,000'), null)
  assert.equal(parseClock('0:00:01.5'), 1500)
  assert.equal(parseClock('01:02:03,004'), 3723004)
})

test('every format round-trips through serialize and parse', () => {
  const cues = [cue('c1', 1000, 2500, '<i>Hello</i>\nworld & co'), cue('c2', 3000, 4200, 'Second')]
  for (const f of ['srt', 'vtt', 'ass', 'ttml'] as const) {
    const back = parse(serialize(cues, f)).cues
    assert.deepEqual(back.map(c => [c.start, c.end, c.text]), cues.map(c => [c.start, c.end, c.text]), f)
  }
  assert.equal(parse(serialize(cues, 'sbv'), 'sbv').cues[0].text, 'Hello\nworld & co')
})

test('shot lists accept seconds, clocks and SMPTE timecodes, and report bad lines', () => {
  const r = parseShotList('# cuts\n1.5\n00:00:02.250\n00:00:03:12\n12:xx\n1.5', 24)
  assert.deepEqual(r.shots, [1500, 2250, 3500])
  assert.deepEqual(r.bad, [5])
})

// ---------- Text metrics ----------

test('reading speed counts spaces and punctuation but not tags; Korean counts Latin as half', () => {
  assert.equal(cps('<i>Hello, you</i>', 1000), 10)
  assert.equal(lineChars('안녕 OK', true), 2 + 1.5)
})

test('word counts are language-aware for CJK', () => {
  assert.equal(wordCount('The dough doubles in five hours.'), 6)
  assert.ok(wordCount('我们每天喂两次酵种', 'zh') >= 3)
})

test('rebreak keeps short text on one line and does not strand articles or prepositions', () => {
  assert.equal(rebreak('Temperature matters\nmore than anything.', 42), 'Temperature matters more than anything.')
  const r = rebreak('We feed the starter twice a day, with the flour from a mill in Kent.', 42)
  const [a, b] = r.split('\n')
  assert.ok(a.length <= 42 && b.length <= 42)
  assert.equal(weakEnd(a, 'en'), null)
  assert.equal(weakEnd('Ich gehe mit der', 'de'), 'der')
})

// ---------- QC ----------

test('Netflix presets resolve per language and for children', () => {
  assert.equal(rulesFor(NF, 'en-US').maxCps, 20)
  assert.equal(rulesFor(NF, 'de').maxCps, 17)
  assert.equal(rulesFor(NF, 'de', true).maxCps, 13)
  assert.equal(rulesFor(NF, 'ja').maxChars, 13)
  assert.equal(Math.round(en.minGapFrames * 1000 / en.fps), 83)
  assert.equal(customFrom(NF, { maxCps: 15 }).base.maxCps, 15)
})

test('flags reading speed, line length, line count and flashing cues', () => {
  const issues = check([
    cue('a', 0, 1000, 'This line is far too long to read in one second.'),
    cue('b', 2000, 2400, 'Hi'),
    cue('c', 4000, 8000, 'One\nTwo\nThree'),
    cue('d', 9000, 12000, 'A line that is definitely longer than forty-two characters'),
  ], en, { lang: 'en' })
  assert.ok(issues.some(i => i.cueId === 'a' && i.rule === 'cps' && i.severity === 'error'))
  assert.ok(issues.some(i => i.cueId === 'b' && i.rule === 'min-duration'))
  assert.ok(issues.some(i => i.cueId === 'c' && i.rule === 'line-count'))
  assert.ok(issues.some(i => i.cueId === 'd' && i.rule === 'line-length'))
})

test('flags overlaps, sub-minimum gaps and short gaps that should be closed', () => {
  const issues = check([cue('a', 0, 2000, 'One'), cue('b', 1900, 4000, 'Two'), cue('c', 4040, 6000, 'Three'), cue('d', 6300, 8000, 'Four'), cue('e', 9000, 11000, 'Five')], en, { lang: 'en' })
  assert.deepEqual(issues.filter(i => ['overlap', 'gap'].includes(i.rule)).map(i => [i.cueId, i.rule, i.severity]), [['b', 'overlap', 'error'], ['c', 'gap', 'error'], ['d', 'gap', 'warn']])
})

test('shot-change proximity: in-time a few frames after a cut is flagged, on the cut is not', () => {
  const shots = [1000, 5000]
  const issues = check([cue('a', 1200, 3000, 'Near the cut'), cue('b', 5000, 7000, 'On the cut')], en, { lang: 'en', shots })
  assert.deepEqual(issues.filter(i => i.rule === 'shot-change').map(i => i.cueId), ['a'])
})

test('tags and forbidden characters', () => {
  const issues = check([cue('a', 0, 2000, '<i>Open italics'), cue('b', 3000, 5000, '<b>Bold</b> text'), cue('c', 6000, 8000, 'Arrow ▶ here')], en, { lang: 'en' })
  assert.deepEqual(issues.filter(i => i.rule === 'tags' || i.rule === 'chars').map(i => [i.cueId, i.rule]), [['a', 'tags'], ['b', 'tags'], ['c', 'chars']])
})

test('translation checks: alignment, untranslated lines, numbers and names', () => {
  const src = [cue('s1', 0, 2000, 'Good morning, everyone!'), cue('s2', 2100, 4000, 'We sold 1,250 loaves to Priya.'), cue('s3', 4100, 6000, 'See you tomorrow.')]
  const tgt = [cue('t1', 0, 2000, 'Good morning, everyone!'), cue('t2', 2100, 4000, 'Vendimos 1.520 panes a Pria.'), cue('t3', 4150, 6000, 'Hasta mañana.')]
  const a = align(tgt, src)
  assert.deepEqual([...a.values()].map(v => v.map(c => c.id)), [['s1'], ['s2'], ['s3']])
  const issues = check(tgt, rulesFor(NF, 'es'), { lang: 'es', source: src })
  assert.ok(issues.some(i => i.cueId === 't1' && i.rule === 'untranslated'))
  assert.ok(issues.some(i => i.cueId === 't2' && i.rule === 'numbers' && i.message.includes('1250')))
  assert.ok(issues.some(i => i.cueId === 't2' && i.rule === 'names' && i.message.includes('Priya')))
  assert.deepEqual(namesIn('Mrs. Okafor met Tom in Kent. Then they left.'), ['Tom', 'Kent'])
})

test('expansion ratio flags outliers against the aligned source', () => {
  const src = [cue('s', 0, 3000, 'Bread is a small thing.')]
  const tgt = [cue('t', 0, 3000, 'Brot ist eigentlich nur eine sehr kleine Sache.')]
  const ex = expansion(tgt, src)
  assert.ok(ex.overall > 1.9)
  assert.ok(check(tgt, rulesFor(NF, 'de'), { lang: 'de', source: src }).some(i => i.rule === 'expansion'))
})

test('score is 100 when clean and drops with issues; summary has pass/fail per rule', () => {
  const clean = [cue('a', 0, 2000, 'Hello there.')]
  assert.equal(score(clean, check(clean, en, { lang: 'en' })), 100)
  const bad = [cue('a', 0, 300, 'Far too fast to read here.'), cue('b', 1000, 3000, 'Fine.')]
  const iss = check(bad, en, { lang: 'en' })
  assert.ok(score(bad, iss) <= 50)
  const sum = summarize(iss, false)
  assert.equal(sum.find(s => s.id === 'min-duration')!.pass, false)
  assert.equal(sum.find(s => s.id === 'overlap')!.pass, true)
  assert.ok(!sum.some(s => s.id === 'expansion'))
})

// ---------- Fixes ----------

test('overlap fix trims the earlier cue to end two frames before the next', () => {
  const cues = [cue('a', 0, 2500, 'One'), cue('b', 2000, 4000, 'Two')]
  const ch = propose(cues, en, { lang: 'en' }).find(c => c.kind === 'overlap')!
  const out = applyChange(cues, ch)!
  assert.equal(out[0].end, 2000 - 83)
})

test('extend uses the following gap, then borrows from a next cue with time to spare', () => {
  const r = rulesFor(NF, 'de')
  const text = 'Die Temperatur ist wichtiger als alles andere.' // 46 chars needs 2.71 s at 17 CPS
  const ext = propose([cue('a', 0, 2000, text), cue('b', 5000, 7000, 'Ja.')], r, { lang: 'de' }).find(c => c.kind === 'extend')!
  assert.equal(ext.after[0].end, Math.round(46 / 17 * 1000))
  const borrow = propose([cue('a', 0, 2000, text), cue('b', 2083, 6000, 'Ja.')], r, { lang: 'de' }).find(c => c.kind === 'extend')!
  assert.equal(borrow.after.length, 2)
  assert.ok(borrow.after[0].end - borrow.after[0].start >= needMs(borrow.after[0], r, 'de') - 1)
  assert.ok(borrow.after[1].start - borrow.after[0].end >= 83)
})

test('flashing cue with no room is merged with the next one', () => {
  const ch = propose([cue('a', 0, 600, 'Oh.'), cue('b', 650, 1500, 'Hello there.'), cue('c', 1583, 4000, 'Hm.')], en, { lang: 'en' })
  assert.ok(ch.some(c => c.kind === 'merge' && c.after[0].text === 'Oh. Hello there.'))
})

test('split breaks over-long cues at a sentence end with a two-frame gap', () => {
  const c = cue('a', 0, 9000, 'This cue stays on screen far too long. Nobody should read one subtitle for nine seconds.')
  const ch = propose([c], en, { lang: 'en' }).find(x => x.kind === 'split')!
  assert.equal(ch.after.length, 2)
  assert.equal(ch.after[0].text, 'This cue stays on screen far too long.')
  assert.ok(ch.after[1].start - ch.after[0].end >= 83)
  assert.notEqual(ch.after[0].id, ch.after[1].id)
})

test('snap moves an in-time onto a nearby shot change, pulling the previous out-time back', () => {
  const cues = [cue('a', 0, 2150, 'Before the cut.'), cue('b', 2210, 4500, 'After the cut.')]
  const ch = propose(cues, en, { lang: 'en', shots: [2000] }).find(c => c.kind === 'snap' && c.before.length === 2)!
  const out = applyChange(cues, ch)!
  assert.equal(out[1].start, 2000)
  assert.equal(out[0].end, 2000 - 83)
})

test('rejected fixes are not proposed again, and stale changes are refused', () => {
  const cues = [cue('a', 0, 2500, 'One'), cue('b', 2000, 4000, 'Two')]
  const [ch] = propose(cues, en, { lang: 'en' })
  assert.ok(!propose(cues, en, { lang: 'en' }, new Set([ch.key])).some(c => c.key === ch.key))
  assert.equal(applyChange([cues[0], { ...cues[1], start: 2100 }], ch), null)
})

test('auto-fix on the German sample removes every overlap and raises the score', () => {
  const src = parse(SAMPLE_FILES[0].text).cues
  const de = SAMPLE_FILES.find(f => f.lang === 'de')!
  const p = parse(de.text, null, de.name)
  assert.equal(p.format, 'ass')
  assert.ok(p.issues.filter(i => i.kind === 'overlap').length >= 5)
  const r = rulesFor(NF, 'de')
  const ctx = { lang: 'de', shots: SAMPLE_SHOTS, source: src }
  const before = score(p.cues, check(p.cues, r, ctx))
  const { cues, applied } = autoFix(p.cues, r, ctx)
  const after = check(cues, r, ctx)
  assert.ok(applied.length > 10)
  assert.equal(after.filter(i => i.rule === 'overlap' || i.rule === 'gap').length, 0)
  assert.ok(score(cues, after) > before + 30)
  assert.ok(new Set(cues.map(c => c.id)).size === cues.length)
  const ex = expansion(p.cues, src)
  assert.ok(ex.overall > 1.2 && ex.overall < 1.45)
})

test('auto-fix is idempotent on its own output', () => {
  const p = parse(SAMPLE_FILES[0].text)
  const ctx = { lang: 'en', shots: SAMPLE_SHOTS }
  const once = autoFix(p.cues, en, ctx).cues
  assert.equal(autoFix(once, en, ctx).applied.length, 0)
})

// ---------- Sync tools ----------

test('shift, two-point resync and 23.976 to 25 fps conversion', () => {
  const cues = [cue('a', 1000, 2000, 'x'), cue('b', 11000, 12000, 'y')]
  assert.deepEqual(shift(cues, -1500).map(c => [c.start, c.end]), [[0, 500], [9500, 10500]])
  const rs = resync(cues, 1000, 1500, 11000, 12500)
  assert.deepEqual(rs.map(c => [c.start, c.end]), [[1500, 2600], [12500, 13600]])
  const pal = convertFps([cue('a', 25000, 26000, 'x')], FPS.film, FPS.pal)
  assert.equal(pal[0].start, Math.round(25000 * (24000 / 1001) / 25))
  assert.throws(() => resync(cues, 5, 6, 5, 7))
})
