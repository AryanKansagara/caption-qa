import { choose, expect, exportAs, importFiles, newProject, pending, srt, tab, test, toasts } from './fixtures.ts'

const EV = '[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
const TT = (body: string) => `<?xml version="1.0"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25" xml:lang="en"><body><div>${body}</div></body></tt>`
// The same two cues in every format: 1.0 to 2.5 s in italics over two lines, 5.4 to 7.0 s plain.
const FORMATS: [name: string, label: string, body: string][] = [
  ['f_en.srt', 'SubRip (.srt)', srt([1000, 2500, '<i>Hello\nthere</i>'], [5400, 7000, 'Salt & pepper'])],
  ['f_en.vtt', 'WebVTT (.vtt)', 'WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.500 align:start\n<i>Hello\nthere</i>\n\n00:05.400 --> 00:07.000\n<v Ann>Salt &amp; pepper\n'],
  ['f_en.ass', 'ASS/SSA (.ass)', `${EV}Comment: 0,0:00:00.00,0:00:01.00,D,,0,0,0,,no\nDialogue: 0,0:00:01.00,0:00:02.50,D,,0,0,0,,{\\i1}Hello\\Nthere{\\i0}\nDialogue: 0,0:00:05.40,0:00:07.00,D,,0,0,0,,{\\pos(1,2)}Salt & pepper\n`],
  // 25 fps: 00:00:05:10 is 5 s + 10 x 40 ms.
  ['f_en.ttml', 'TTML/DFXP (.ttml)', TT('<p begin="1s" dur="1500ms"><span tts:fontStyle="italic">Hello<br/>there</span></p><p begin="00:00:05:10" end="00:00:07:00">Salt &amp; pepper</p>')],
]

for (const [name, label, body] of FORMATS) {
  test(`${label} reads the same cues and exports to every format`, async ({ page }) => {
    await newProject(page)
    await choose(page, [name, body])
    await expect(pending(page, name)).toContainText(`${label} · UTF-8 · 2 cues`)
    await expect(pending(page, name)).toContainText('Read cleanly')
    await page.getByRole('button', { name: 'Add 1 track' }).click()
    await expect(page.getByRole('rowheader').filter({ hasText: name })).toBeVisible()
    expect((await exportAs(page, 'English', 'srt')).text).toBe('1\n00:00:01,000 --> 00:00:02,500\n<i>Hello\nthere</i>\n\n2\n00:00:05,400 --> 00:00:07,000\nSalt & pepper\n')
    expect((await exportAs(page, 'English', 'sbv')).text).toBe('0:00:01.000,0:00:02.500\nHello\nthere\n\n0:00:05.400,0:00:07.000\nSalt & pepper\n')
    expect((await exportAs(page, 'English', 'vtt')).text).toContain('00:00:01.000 --> 00:00:02.500\n<i>Hello\nthere</i>\n')
    expect((await exportAs(page, 'English', 'ass')).text).toContain('Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Hello\\Nthere{\\i0}\n')
    const ttml = await exportAs(page, 'English', 'ttml')
    expect(ttml.name).toBe('f_en.qc.ttml')
    const xml = await page.evaluate((t) => { const d = new DOMParser().parseFromString(t, 'application/xml'); return { bad: d.querySelector('parsererror') !== null, text: [...d.getElementsByTagName('p')].map((p) => `${p.getAttribute('begin')} ${p.textContent}`) } }, ttml.text)
    expect(xml).toEqual({ bad: false, text: ['00:00:01.000 Hellothere', '00:00:05.400 Salt & pepper'] })
  })
}

test('SBV', async ({ page }) => {
  await newProject(page)
  await importFiles(page, ['f_en.sbv', '0:00:01.000,0:00:02.500\nHello\nthere\n\n1:00:05.400,1:00:07.000\nBye\n'])
  expect((await exportAs(page, 'English', 'srt')).text).toBe('1\n00:00:01,000 --> 00:00:02,500\nHello\nthere\n\n2\n01:00:05,400 --> 01:00:07,000\nBye\n')
})

test('encodings: BOM with CRLF, UTF-16 LE and Windows-1252', async ({ page }) => {
  await newProject(page)
  const text = srt([1000, 3000, 'Café'])
  await choose(page,
    ['bom.srt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text.replace(/\n/g, '\r\n'))])],
    ['u16.srt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])],
    ['w1252.srt', Buffer.from(text, 'latin1')])
  await expect(pending(page, 'bom.srt')).toContainText('UTF-8 (BOM) · 1 cues')
  await expect(pending(page, 'u16.srt')).toContainText('UTF-16 LE (BOM) · 1 cues')
  await expect(pending(page, 'w1252.srt')).toContainText('decoded as Windows-1252')
  await page.getByRole('button', { name: 'Add 3 tracks' }).click()
  await tab(page, 'Review')
  for (let i = 0; i < 3; i++) {
    await page.getByRole('radiogroup', { name: 'Track' }).getByRole('radio').nth(i).click()
    await expect(page.locator('table.sbs tbody tr td').nth(i === 0 ? 3 : 4)).toHaveText('Café')
  }
})

test('empty, wrong and unreadable files add nothing', async ({ page }) => {
  await newProject(page)
  await choose(page, ['empty.srt', ''], ['json.srt', '{"a":1}'], ['head.vtt', 'WEBVTT\n'], ['bytes.ass', Buffer.from([0, 1, 2, 3, 255, 254])], ['page.xml', '<html><p>Hi</p></html>'])
  for (const f of ['empty.srt', 'json.srt', 'head.vtt', 'bytes.ass', 'page.xml']) await expect(pending(page, f)).toContainText('No cues could be read from this file.')
  await expect(page.getByRole('button', { name: /^Add 0 track/ })).toBeDisabled()
})

test('a truncated file keeps the whole cues and names the broken line', async ({ page }) => {
  await newProject(page)
  await choose(page, ['cut.srt', srt([1000, 3000, 'One'], [4000, 6000, 'Two']).slice(0, -20)])
  await expect(pending(page, 'cut.srt')).toContainText('1 cues')
  await expect(pending(page, 'cut.srt')).toContainText('Line 5timecode')
  await expect(pending(page, 'cut.srt')).toContainText('1 errors, 0 warnings while reading')
})

test('timing problems are reported with line numbers', async ({ page }) => {
  await newProject(page)
  await choose(page, ['bad.srt', '1\n00:00:01,000 --> 00:00:03,000\nA\n\n3\n00:00:02,000 --> 00:00:04,000\nB\n\n4\n00:00:0X,000 --> 00:00:05,000\nC\n\n5\n00:00:08,000 --> 00:00:07,000\nD\n'])
  const report = pending(page, 'bad.srt').locator('.parse-report li')
  await expect(report).toHaveCount(4)
  expect((await report.allTextContents()).map((t) => t.slice(0, 18))).toEqual(['Line 5numberingNum', 'Line 6overlapOverl', 'Line 10timecodeUnr', 'Line 14negativeEnd'])
})

test('a bad shot list is refused and leaves the old one', async ({ page }) => {
  await newProject(page)
  await page.getByLabel('Shot list').fill('1.5\n2.5')
  await page.getByRole('button', { name: 'Load shot list' }).click()
  await expect(page.getByText('2 loaded')).toBeVisible()
  await page.getByLabel('Shot list').fill('12:xx\n00:99:00')
  await page.getByRole('button', { name: 'Load shot list' }).click()
  await expect(toasts(page)).toContainText('No readable times. Check lines 1, 2.')
  await expect(page.getByText('2 loaded')).toBeVisible()
})
