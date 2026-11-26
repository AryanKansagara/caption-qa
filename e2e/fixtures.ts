import { readFileSync } from 'node:fs'
import { test as base, expect, type Locator, type Page } from '@playwright/test'

/** The only external hosts the page asks for: web fonts in index.html. They are answered with an empty stylesheet. */
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

export const test = base.extend<{ guard: void }>({
  // Every test: only the app is reachable, and an uncaught page error fails the test.
  guard: [
    async ({ context, baseURL }, use) => {
      const errors: string[] = []
      const external: string[] = []
      const origin = new URL(baseURL!).origin
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.origin === origin) return route.continue()
        external.push(url.host)
        if (FONT_HOSTS.has(url.host)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
        return route.abort('blockedbyclient')
      })
      context.on('weberror', (e) => errors.push(String(e.error())))
      // The clipboard is replaced so a test can read what the page copied without browser permissions.
      await context.addInitScript(() => {
        const copied: string[] = []
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true })
        Object.assign(window, { __copied: copied })
      })
      await use()
      expect(errors, 'uncaught page errors').toEqual([])
      expect(external.filter((h) => !FONT_HOSTS.has(h)), 'requests to other hosts').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? '')
export const toasts = (page: Page) => page.locator('.toasts')

/** Creates an empty project and stops on its Setup tab. */
export async function newProject(page: Page) {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Import your files' }).or(page.getByRole('button', { name: 'New project' })).first().click()
  await expect(page.getByRole('heading', { name: 'Tracks' })).toBeVisible()
}

/** Hands files to the importer without adding them. */
export const choose = (page: Page, ...files: [name: string, body: string | Buffer][]) =>
  page.locator('.dropzone input[type=file]').setInputFiles(files.map(([name, body]) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(body) })))

/** The card of a chosen file that is waiting to be added. */
export const pending = (page: Page, name: string): Locator => page.locator('.pending-file').filter({ has: page.getByText(name, { exact: true }) })

/** Chooses files, adds them all and waits until the project lists them. */
export async function importFiles(page: Page, ...files: [name: string, body: string | Buffer][]) {
  await choose(page, ...files)
  for (const [name] of files) await expect(pending(page, name)).toBeVisible()
  await page.getByRole('button', { name: /^Add \d+ track/ }).click()
  await expect(page.locator('.pending')).toHaveCount(0)
  await expect(toasts(page)).toContainText('Added') // shown once the project is stored
  for (const [name] of files) await expect(page.getByRole('rowheader').filter({ hasText: name })).toBeVisible()
}

export type Tab = 'QC overview' | 'Review' | 'Fixes' | 'Batch' | 'History' | 'Export' | 'Setup'
export async function tab(page: Page, name: Tab) {
  const link = page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name, exact: true })
  await link.click()
  await expect(link).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('main .boot')).toHaveCount(0)
}

/** The track card on the overview: "score | file line | counts line". */
export async function card(page: Page, lang: string) {
  const c = page.locator('.track-card').filter({ has: page.getByText(new RegExp(`^${lang} `)) })
  await expect(c).toHaveCount(1)
  return `${await c.locator('.score-ring b').textContent()} | ${(await c.locator('small').nth(1).textContent())} | ${(await c.locator('small').nth(2).textContent())}`
}

/** Overview issue list as "#cue · time Rule message". */
export async function issues(page: Page) {
  await expect(page.locator('.rule-table')).toBeVisible()
  return page.locator('.issue-list > li').evaluateAll((els) => els.map((e) => `${e.querySelector('.issue-time')?.textContent?.split(' · ')[0]} ${e.className} ${e.querySelector('b')?.textContent}: ${e.querySelector('div > div > span')?.textContent}`))
}

export async function downloaded(page: Page, click: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent('download'), click()])
  return { name: d.suggestedFilename(), text: readFileSync((await d.path())!, 'utf8') }
}

/** Exports a track as a format from the Export tab. */
export async function exportAs(page: Page, lang: string, format: 'srt' | 'vtt' | 'ass' | 'ttml' | 'sbv') {
  await tab(page, 'Export')
  await page.getByLabel(`Export format for ${lang}`).selectOption(format)
  const r = page.getByRole('row').filter({ has: page.getByLabel(`Export format for ${lang}`) })
  return downloaded(page, () => r.getByRole('button', { name: 'Download' }).click())
}

const clock = (ms: number) => `${new Date(ms).toISOString().slice(11, 19)},${String(ms % 1000).padStart(3, '0')}`
/** An SRT file from [start ms, end ms, text] rows. */
export const srt = (...cues: [number, number, string][]) => cues.map(([a, b, t], i) => `${i + 1}\n${clock(a)} --> ${clock(b)}\n${t}\n`).join('\n')
