import { card, choose, downloaded, expect, exportAs, importFiles, issues, newProject, pending, srt, tab, test, toasts, type Tab } from './fixtures.ts'
import type { Page } from '@playwright/test'

// Regression tests, one or more per issue. A newly found bug is pinned with `test.fail` until it is fixed.
// Everything before the last assertions waits as usual; the last ones are immediate reads of a settled page.

const EV = '[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
const TT = (body: string, attrs = '') => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ${attrs} xml:lang="en"><body><div>${body}</div></body></tt>`
async function project(page: Page, name: string, body: string, then?: Tab) {
  await newProject(page)
  await importFiles(page, [name, body])
  if (then) await tab(page, then)
}
async function acceptAll(page: Page) {
  await tab(page, 'Fixes')
  await page.getByRole('button', { name: 'Accept all' }).click()
  await expect(toasts(page)).toContainText('Applied')
}
const times = (s: string) => s.match(/.* --> .*/g)

test('#2 a PySceneDetect scene list loads its start times, not its scene numbers', async ({ page }) => {
  await newProject(page)
  await page.getByLabel('Shot list').fill('Timecode List:,00:00:05.005,00:00:09.510\nScene Number,Start Frame,Start Timecode,Start Time (seconds),End Frame\n1,1,00:00:00.000,0.000,120\n2,121,00:00:05.005,5.005,228\n3,229,00:00:09.510,9.510,300\n')
  await page.getByRole('button', { name: 'Load shot list' }).click()
  await expect(toasts(page)).toContainText('shot changes loaded')
  await tab(page, 'Setup')
  const shots = await savedShots(page)
  expect(shots.filter((s) => s > 0)).toEqual([5005, 9510])
})

test('#3 a cue after a missing blank line is not swallowed', async ({ page }) => {
  await newProject(page)
  await choose(page, ['a_en.srt', '1\n00:00:01,000 --> 00:00:02,000\nHello\n2\n00:00:03,000 --> 00:00:04,000\nBye\n'], ['b_en.vtt', 'WEBVTT\n00:01.000 --> 00:02.000\nHi\n\n00:03.000 --> 00:04.000\nBye\n'])
  await expect(pending(page, 'b_en.vtt')).toBeVisible()
  expect(await pending(page, 'a_en.srt').textContent()).toContain('2 cues')
  expect(await pending(page, 'b_en.vtt').textContent()).toContain('2 cues')
})

test('#4 re-breaking Korean keeps the spaces between words', async ({ page }) => {
  await project(page, 'a_ko.srt', srt([1000, 5000, '안녕하세요\n여러분']))
  await acceptAll(page)
  expect((await exportAs(page, 'Korean', 'srt')).text).toContain('안녕하세요 여러분\n')
})

test('#5 TTML frame rate written as 1000:1001 gives real times, and an empty <p/> does not take the next cue', async ({ page }) => {
  await newProject(page)
  await importFiles(page, ['a_en.dfxp', TT('<p begin="00:00:01:13" end="00:00:03:00">One</p>', 'ttp:frameRate="24" ttp:frameRateMultiplier="1000:1001"')])
  await importFiles(page, ['b_de.ttml', TT('<p begin="1s" end="2s"/><p begin="3s" end="4s">Zwei</p>')])
  // 13 frames at 24 x 1000/1001 fps last 542.2 ms.
  expect(times((await exportAs(page, 'English', 'srt')).text)).toEqual(['00:00:01,542 --> 00:00:03,000'])
  expect((await exportAs(page, 'German', 'srt')).text).toContain('00:00:03,000 --> 00:00:04,000\nZwei')
})

test('#6 a cleared rule field does not become 0', async ({ page }) => {
  await project(page, 'a_en.srt', srt([1000, 3000, 'One'], [5000, 7000, 'Two']))
  const fps = page.getByLabel('Frame rate')
  for (const bad of ['', '0', '-24', '0.5']) {
    await fps.fill(bad)
    await expect(page.getByRole('alert')).toHaveText('At least 1. 24 stays in use.')
  }
  await fps.blur()
  await expect(fps).toHaveValue('24')
  await expect(page.getByText('with custom edits')).toHaveCount(0)
  // Clearing and typing works, and 0 still turns a check off.
  await fps.fill('')
  await fps.pressSequentially('25')
  await expect(page.getByText('with custom edits')).toBeVisible()
  await page.getByLabel('Max characters / second').fill('0')
  await page.reload()
  await expect(fps).toHaveValue('25')
  await expect(page.getByLabel('Max characters / second')).toHaveValue('0')
  await tab(page, 'QC overview')
  expect(await issues(page)).toEqual([])
})

test('#7 times after the first hour keep their hour', async ({ page }) => {
  await project(page, 'a_en.srt', srt([3903200, 3905200, 'One ★']), 'QC overview')
  await expect(page.locator('.issue-time')).toHaveCount(1)
  expect(await page.locator('.issue-time').textContent()).toBe('#1 · 1:05:03.20')
  await tab(page, 'Review')
  expect(await page.locator('table.sbs tbody td').nth(1).textContent()).toBe('1:05:03.201:05:05.20')
  await page.getByRole('link', { name: 'QC report' }).click()
  await expect(page.locator('.report-table.issues tbody td').nth(1)).toHaveText('1:05:03.20')
})

test('#8 text in angle brackets survives export', async ({ page }) => {
  await project(page, 'a_fr.srt', srt([1000, 3000, '<<Bonjour>> dit-il']))
  expect((await exportAs(page, 'French', 'sbv')).text).toContain('<<Bonjour>> dit-il')
})

test('#9 an empty line inside a cue does not cut the exported cue', async ({ page }) => {
  await project(page, 'a_en.ass', `${EV}Dialogue: 0,0:00:01.00,0:00:03.00,D,,0,0,0,,One\\N\\NTwo\n`)
  expect((await exportAs(page, 'English', 'srt')).text).not.toContain('One\n\nTwo')
})

test('#10 splitting an italic cue keeps both halves balanced', async ({ page }) => {
  await project(page, 'a_en.srt', srt([1000, 10000, '<i>This cue stays on screen far too long. Nobody should read one subtitle for nine seconds.</i>']))
  await acceptAll(page)
  expect((await exportAs(page, 'English', 'srt')).text).toContain('far too long.</i>')
})

test('#11 auto-fix never ends a cue before it starts', async ({ page }) => {
  const long = 'Aaaa bbbb cccc dddd eeee ffff gggg hhhh iii'
  await project(page, 'a_en.srt', srt([0, 990, 'Some text here'], [1000, 1050, 'Short but with quite a lot of words here'], [1060, 3000, `${long.slice(0, 40)}\n${long.slice(0, 40)}`]))
  await acceptAll(page)
  const t = times((await exportAs(page, 'English', 'srt')).text)!.map((x) => x.split(' --> '))
  expect(t.filter(([a, b]) => b <= a)).toEqual([])
})

test('#12 a cue under a long earlier cue is an overlap', async ({ page }) => {
  await project(page, 'a_en.srt', srt([1000, 7000, 'Long narration here'], [2000, 3000, 'Short one'], [4000, 6000, 'Third one']), 'QC overview')
  expect((await issues(page)).filter((i) => i.includes('Overlaps')).map((i) => i.slice(0, 2))).toEqual(['#2', '#3'])
})

test('#13 TTML export is well-formed when italics are never closed', async ({ page }) => {
  await project(page, 'a_en.srt', srt([1000, 3000, '<i>Open italics']))
  const { text } = await exportAs(page, 'English', 'ttml')
  expect(await page.evaluate((t) => new DOMParser().parseFromString(t, 'application/xml').querySelector('parsererror') !== null, text)).toBe(false)
})

test('#14 CSV cells cannot run as formulas and file names are quoted', async ({ page }) => {
  await project(page, 'a, final_en.srt', srt([1000, 3000, '=HYPERLINK("http://x.test";"★")']), 'Export')
  const csv = await downloaded(page, () => page.getByRole('button', { name: 'Issues CSV' }).click())
  const sum = await downloaded(page, () => page.getByRole('button', { name: 'Summary CSV' }).click())
  expect(csv.text).not.toMatch(/,"?=HYPERLINK/)
  expect(sum.text).toContain('"a, final_en.srt"')
})

test('#15 a two-point resync that would run time backwards is refused', async ({ page }) => {
  await project(page, 'a_en.srt', srt([1000, 2000, 'One'], [11000, 12000, 'Two']), 'Fixes')
  await page.getByLabel('Early: now').fill('1')
  await page.getByLabel('should be').first().fill('12')
  await page.getByLabel('Late: now').fill('11')
  await page.getByLabel('should be').last().fill('2')
  await page.getByRole('button', { name: 'Resync', exact: true }).click()
  await expect(toasts(page)).toContainText('These points would run time backwards')
  await page.getByLabel('should be').first().fill('5')
  await page.getByLabel('should be').last().fill('5')
  await page.getByLabel('Apply to every track').check()
  await page.getByRole('button', { name: 'Resync', exact: true }).click()
  await expect(toasts(page)).toContainText('The two correct times must be different')
  expect(times((await exportAs(page, 'English', 'srt')).text)).toEqual(['00:00:01,000 --> 00:00:02,000', '00:00:11,000 --> 00:00:12,000'])
})

test('#16 a long track with one error does not score 100', async ({ page }) => {
  await project(page, 'a_en.srt', srt(...Array.from({ length: 300 }, (_, i): [number, number, string] => [i * 3000, i * 3000 + 2000, i ? 'Clean line.' : 'Bad ★ line.'])), 'QC overview')
  expect(await card(page, 'English')).toBe('99 | a_en.srt · 300 cues | 1 errors · 0 warnings')
})

test('#17 a file without cues is not called cleanly read', async ({ page }) => {
  await newProject(page)
  await choose(page, ['empty.srt', ''])
  await expect(pending(page, 'empty.srt')).toContainText('No cues could be read')
  expect(await pending(page, 'empty.srt').textContent()).not.toContain('Read cleanly')
})

test('#18 two numbers next to each other stay two numbers', async ({ page }) => {
  await newProject(page)
  await importFiles(page, ['t_en.srt', srt([1000, 4000, 'In 2009 100 people came'])], ['t_es.srt', srt([1000, 4000, 'En 2009, 100 personas vinieron'])])
  await tab(page, 'QC overview')
  expect((await issues(page)).filter((i) => i.includes('Number'))).toEqual([])
})

test('#19 ASS drawings are not subtitle text', async ({ page }) => {
  await newProject(page)
  await choose(page, ['a_en.ass', `${EV}Dialogue: 0,0:00:01.00,0:00:03.00,D,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}\nDialogue: 0,0:00:04.00,0:00:06.00,D,,0,0,0,,Hello\n`])
  await expect(pending(page, 'a_en.ass')).toBeVisible()
  expect(await pending(page, 'a_en.ass').textContent()).toContain('1 cues')
})

test('#20 a cue that starts exactly on a cut is left there', async ({ page }) => {
  await project(page, 'a_en.srt', srt([5000, 7000, 'On the cut here']))
  await page.getByLabel('Shot list').fill('5\n5.25')
  await page.getByRole('button', { name: 'Load shot list' }).click()
  await expect(toasts(page)).toContainText('2 shot changes loaded')
  await tab(page, 'QC overview')
  expect(await issues(page)).toEqual([])
})

test('#21 the report says when cues were lost on import', async ({ page }) => {
  await project(page, 'a_en.srt', '1\n00:00:01,000 --> 00:00:03,000\nOne\n\n2\n00:00:0X,000 --> 00:00:06,000\nLost\n', 'Export')
  await page.getByRole('link', { name: 'Open printable report' }).click()
  await expect(page.getByRole('heading', { name: 'Pass / fail per rule' })).toBeVisible()
  expect(await page.locator('.report').textContent()).toMatch(/Unreadable timecode|skipped/i)
  const row = page.locator('.report-table').first().locator('tbody tr')
  await expect(row.locator('.badge')).toHaveText('Incomplete import')
  await expect(row).toContainText('1 import error')
  await expect(page.locator('.report .parse-report li')).toHaveText(['Line 6timecodeUnreadable timecode "00:00:0X,000 --> 00:00:06,000". Cue skipped.'])
  const sum = await downloaded(page, () => page.getByRole('button', { name: 'Summary CSV' }).click())
  const cells = sum.text.trim().split('\n').map((l) => l.split(','))
  expect(cells.map((c) => c.at(-1))).toEqual(['import-errors', '1'])
})

test('#21 timing errors that were read do not hide a pass, and clean files are unchanged', async ({ page }) => {
  await newProject(page)
  await importFiles(page, ['a_en.srt', srt([1000, 2900, 'One fine day'], [3000, 5000, 'Two'])], ['b_de.srt', srt([1000, 3500, 'Ein guter Tag'], [3000, 5000, 'Zwei'])])
  await acceptAll(page)
  await page.getByRole('link', { name: 'QC report' }).click()
  const rows = page.locator('.report-table').first().locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).locator('td').last()).toHaveText('Pass')
  await expect(rows.nth(1).locator('td').last()).toHaveText('Pass1 import error')
})

test('#22 compare lists every track of a language', async ({ page }) => {
  await newProject(page)
  await importFiles(page, ['a_en.srt', srt([1000, 3000, 'One'])], ['full_de.srt', srt([1000, 3000, 'Eins'])], ['forced_de.srt', srt([1000, 3000, 'Schild'])])
  await tab(page, 'History')
  const rows = page.locator('.panel', { has: page.getByRole('heading', { name: 'Compare' }) }).locator('table').first().locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBe(3)
  await expect(rows.nth(2)).toContainText('forced_de.srt')
  await page.getByRole('button', { name: 'Save snapshot' }).first().click()
  await expect(page.locator('.snap-list li')).toHaveCount(1)
  // Only the second German track changes.
  await tab(page, 'Review')
  await page.getByRole('radiogroup', { name: 'Track' }).getByRole('radio').nth(2).click()
  await page.locator('table.sbs tbody tr').first().click()
  await page.locator('.editor textarea').fill('Neues Schild')
  await page.locator('.editor').getByRole('button', { name: 'Save' }).click()
  await expect(toasts(page)).toContainText('Saved cue #1')
  await tab(page, 'History')
  await expect(page.getByRole('heading', { name: 'German (full_de.srt): 0 changed cues' })).toBeVisible()
  await rows.nth(2).click()
  await expect(page.getByRole('heading', { name: 'German (forced_de.srt): 1 changed cue' })).toBeVisible()
  await expect(page.locator('.diff-table tbody tr')).toContainText(['Neues Schild'])
})

test('#23 closing a gap does not push a cue over the maximum duration', async ({ page }) => {
  // The second pair has room, so there is something to accept.
  await project(page, 'a_en.srt', srt([0, 6900, 'Hello there everyone in the room'], [7300, 9000, 'Bye now'], [9400, 11000, 'See you soon']))
  await acceptAll(page)
  const { text } = await exportAs(page, 'English', 'srt')
  expect(text).toContain('Hello there everyone in the room')
  expect(times(text)).toEqual(['00:00:00,000 --> 00:00:06,900', '00:00:07,300 --> 00:00:09,317', '00:00:09,400 --> 00:00:11,000'])
})

/** Shot changes as stored, read from the project JSON. */
async function savedShots(page: Page): Promise<number[]> {
  await page.goto('/settings')
  const { text } = await downloaded(page, () => page.getByRole('button', { name: 'Export all my data' }).click())
  return JSON.parse(text).projects[0].shots
}
