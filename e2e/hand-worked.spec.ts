import { card, expect, exportAs, importFiles, issues, newProject, srt, tab, test, toasts } from './fixtures.ts'

// Every number here is worked out on paper from the documented rules: Netflix-style English is 20 CPS, 42 characters,
// 2 lines, 0.833 to 7 s, 24 fps (41.667 ms per frame), a minimum gap of 2 frames (83.33 ms), gaps under 12 frames
// (500 ms) to be closed. CPS becomes an error above 1.25 x 20 = 25.
test('hand-worked English track', async ({ page }) => {
  const clean = Array.from({ length: 19 }, (_, i): [number, number, string] => [30000 + i * 4000, 32000 + i * 4000, 'Clean line.'])
  await newProject(page)
  await importFiles(page, ['hand_en.srt', srt(
    [1000, 3000, 'Hello there, Ann.'], // 17 / 2 = 8.5 CPS: clean
    [3050, 4050, 'The oven needs thirty minutes to warm up.'], // 41 / 1 = 41 CPS; gap 50 ms = 1.2 frames
    [4350, 4950, 'Stop.'], // gap 300 ms = 7.2 frames; 0.6 s
    [4900, 7900, 'One\nTwo\nThree'], // 50 ms overlap; 3 lines
    [10000, 18000, 'This single line of text has fifty characters, ok.'], // 50 characters; 8 s
    [20000, 22000, '<i>Open \u2605 star'], // banned star; italics never closed
    ...clean,
  )])
  await tab(page, 'QC overview')
  expect((await issues(page)).sort()).toEqual([
    '#2 error Gaps: Gap of 1 frames before this cue (min 2).',
    '#2 error Reading speed (CPS): 41.0 CPS over the 20 CPS limit (41 chars in 1.00 s).',
    '#3 error Flashing cues: On screen for 0.60 s; needs at least 0.83 s.',
    '#3 warn Gaps: Gap of 7 frames: close it to 2 frames.',
    '#4 error Line count: 3 lines (max 2).',
    '#4 error Overlaps: Starts 50 ms before the previous cue ends.',
    '#5 error Line length: Line 1 has 50 characters (max 42).',
    '#5 warn Maximum duration: On screen for 8.00 s (max 7.00 s).',
    '#6 error Forbidden characters: Forbidden character: \u2605',
    '#6 error Tags and italics: <i> is never closed.',
  ])
  // Penalties 2 + 1.35 + 2 + 1.35 + 2 = 8.7 over 25 cues: 100 x (1 - 0.348) = 65.2.
  expect(await card(page, 'English')).toBe('65 | hand_en.srt \u00b7 25 cues | 8 errors \u00b7 2 warnings')
})

test('hand-worked translation checks', async ({ page }) => {
  await newProject(page)
  await importFiles(page,
    ['t_en.srt', srt([1000, 4000, 'Good morning, everyone!'], [6000, 9000, 'We sold 1,250 loaves to Priya.'], [11000, 14000, 'Bread is a small thing.'])],
    ['t_es.srt', srt([1000, 4000, 'Good morning, everyone!'], [6000, 9000, 'Vendimos 1.520 panes a Pria.'], [11000, 14000, 'El pan es una cosa peque\u00f1a y bonita.'])])
  await tab(page, 'QC overview')
  expect(await issues(page)).toEqual([
    '#1 error Untranslated lines: Identical to the source; looks untranslated.',
    '#2 warn Number consistency: Source number 1250 not found in the target.',
    '#2 warn Name consistency: Name Priya from the source not found in the target.',
    '#3 warn Translation expansion: 57% longer than the source line.', // 36 / 23 = 1.565
  ])
  // Penalties 1 + 0.7 + 0.35 = 2.05 over 3 cues: 31.67. Length (23 + 28 + 36) / (23 + 30 + 23) = 87 / 76 = 1.145.
  expect(await card(page, 'Spanish')).toBe('32 | t_es.srt \u00b7 3 cues | 1 errors \u00b7 3 warnings \u00b7 +14% length')
})

test('hand-worked sync tools', async ({ page }) => {
  await newProject(page)
  await importFiles(page, ['s_en.srt', srt([1000, 2000, 'One'], [11000, 12000, 'Two'], [25000, 26000, 'Three'])])
  const times = async () => (await exportAs(page, 'English', 'srt')).text.match(/.* --> .*/g)
  await tab(page, 'Fixes')
  // Line through (1, 1.5) and (11, 12.5): slope 1.1, so 2 -> 2.6, 12 -> 13.6, 25 -> 27.9, 26 -> 29.
  await page.getByLabel('Early: now').fill('1')
  await page.getByLabel('should be').first().fill('1.5')
  await page.getByLabel('Late: now').fill('0:11')
  await page.getByLabel('should be').last().fill('12.5')
  await page.getByRole('button', { name: 'Resync', exact: true }).click()
  await expect(toasts(page)).toContainText('Two-point resync applied')
  expect(await times()).toEqual(['00:00:01,500 --> 00:00:02,600', '00:00:12,500 --> 00:00:13,600', '00:00:27,900 --> 00:00:29,000'])
  await tab(page, 'Fixes')
  await page.getByRole('button', { name: 'Undo last' }).click()
  await expect(page.locator('.sync-grid')).toBeVisible()
  await page.getByLabel('Offset in ms').fill('-500')
  await page.getByRole('button', { name: 'Shift', exact: true }).click()
  await expect(toasts(page)).toContainText('Shift -500 ms applied')
  expect(await times()).toEqual(['00:00:00,500 --> 00:00:01,500', '00:00:10,500 --> 00:00:11,500', '00:00:24,500 --> 00:00:25,500'])
  await tab(page, 'Fixes')
  await page.getByRole('button', { name: 'Undo last' }).click()
  // 25 s at 24000/1001 fps is 599.4006 frames; at 25 fps that is 23.976024 s. 26 s -> 24.935065, 11 -> 10.549451, 12 -> 11.508492.
  await page.getByRole('button', { name: '23.976 → 25' }).click()
  await expect(toasts(page)).toContainText('23.976 → 25 fps applied')
  expect((await times())!.slice(1)).toEqual(['00:00:10,549 --> 00:00:11,508', '00:00:23,976 --> 00:00:24,935'])
})

test('hand-worked shot changes', async ({ page }) => {
  await newProject(page)
  // 24 fps: 00:00:05:12 is 5.5 s. The cue starts 0.2 s (4.8 frames) after it, inside the 12-frame window.
  await importFiles(page, ['s_en.srt', srt([5700, 8000, 'After the cut'])])
  await page.getByLabel('Shot list').fill('00:00:05:12\n20')
  await page.getByRole('button', { name: 'Load shot list' }).click()
  await expect(toasts(page)).toContainText('2 shot changes loaded')
  await tab(page, 'QC overview')
  expect(await issues(page)).toEqual(['#1 warn Shot changes: Starts 5 frames after a shot change; snap it to the cut.'])
  await tab(page, 'Fixes')
  await page.getByRole('button', { name: 'Accept all' }).click()
  await expect(toasts(page)).toContainText('Applied')
  expect((await exportAs(page, 'English', 'srt')).text).toContain('00:00:05,500 --> 00:00:08,000')
})
