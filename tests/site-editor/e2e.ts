// Shared by the visual editor's end-to-end specs (storefront-service/ui-tests/site-editor, admin-service/ui-tests/
// site-editor): the seed (seed.ts, under tsx, since it reaches store-core) and the canvas message log. Opt in with
// SITE_EDITOR_E2E=1: they switch site_editor_enabled on and write drafts, on jeffi_test only.
import fs from 'node:fs'
import { expect, type Browser, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { runTsx } from '../responsive/tsx'

export const E2E_ON = process.env.SITE_EDITOR_E2E === '1'
export const E2E_SKIP = 'set SITE_EDITOR_E2E=1 to run the visual editor end-to-end (it seeds jeffi_test: tests/site-editor/seed.ts)'
export const STORE_BASE = (process.env.UI_BASE_URL || 'http://localhost:3010').replace(/\/$/, '')
/** The admin app; behind the dev router (:3000) it shares the storefront's origin, which its canvas needs. */
export const ADMIN_BASE = (process.env.ADMIN_UI_BASE_URL || STORE_BASE).replace(/\/$/, '')
const SEED_PATH = 'tests/ui-output/site-editor.json'

export interface Seeded {
  draftId: string
  token: string
  sid: string
  blocks: { hero: string; classic: string }
}

function seed(cmd: 'up' | 'down') {
  runTsx('tests/site-editor/seed.ts', [cmd])
}

export function seedUp(): Seeded {
  seed('up')
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Seeded
}

export const seedDown = () => seed('down')

/** The words the hero's heading starts with (editor-pack.ts). */
export const HERO_HEADING = 'Made by hand, shipped across India'

type Msg = { type: string; [k: string]: unknown }

/** Every `site-editor:*` message the page's window receives from the canvas, kept on window.__msgs. */
export const LOG_SCRIPT = `window.__msgs=[];addEventListener('message',function(e){var d=e.data;if(d&&typeof d.type==='string'&&d.type.indexOf('site-editor:')===0)window.__msgs.push(d)})`

export async function clearMessages(page: Page) {
  await page.evaluate(() => ((window as unknown as { __msgs: Msg[] }).__msgs.length = 0))
}

/** The first message of a type (since the last clear) matching `where`'s fields. */
export async function nextMessage(page: Page, type: string, where: Record<string, unknown> = {}, timeout = 10_000): Promise<Msg> {
  const handle = await page.waitForFunction(
    ([t, w]) => (window as unknown as { __msgs: Msg[] }).__msgs.find(m => m.type === `site-editor:${t}` && Object.entries(w).every(([k, v]) => m[k] === v)) ?? null,
    [type, where] as const,
    { timeout }
  )
  return (await handle.jsonValue()) as Msg
}

/** A page signed in as the seeded admin, in a browser of its own for a whole spec file. */
export async function adminPage(browser: Browser, s: Seeded): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } })
  await context.addCookies([{ name: 'admin_sid', value: s.sid, url: ADMIN_BASE }])
  const p = await context.newPage()
  return p
}

/** The seeded draft in the admin Site Builder, open in the visual editor, its hero drawn on the canvas. */
export async function openEditor(page: Page, s: Seeded): Promise<FrameLocator> {
  await page.setViewportSize({ width: 1920, height: 1200 })
  // The admin reads the flag through a 15s cache: a first load may come before it sees the seed.
  for (let i = 0; ; i++) {
    await page.goto(`${ADMIN_BASE}/admin/settings/site-builder?draft=${s.draftId}`)
    const at = new URL(page.url()).pathname
    if (/\/(login|signin)\b/.test(at)) throw new Error(`the seeded admin session was not honoured: sent to ${at}`)
    const visual = await page
      .getByTitle('Page canvas')
      .waitFor({ timeout: 20_000 })
      .then(
        () => true,
        () => false
      )
    if (visual) break
    if (i === 2) throw new Error('the Site Builder did not open the draft in the visual editor (is site_editor_enabled on?)')
    await page.waitForTimeout(8_000)
  }
  const frame = page.frameLocator('iframe[title="Page canvas"]')
  // Bridge first (it loads once the page hydrated), then one hero heading: until then the canvas may hold the old and new render.
  await canvasReady(frame)
  const heading = await single(frame.locator(`[data-block-id="${s.blocks.hero}"] h1`))
  await expect(heading).toBeVisible({ timeout: 30_000 })
  return frame
}

/** The canvas bridge loaded and in editing mode (it loads after the page hydrates, and again after each reload). */
export const canvasReady = (frame: FrameLocator) => expect(frame.locator('html[data-site-editing]')).toBeAttached({ timeout: 60_000 })

/** The locator once exactly one element matches it: a redraw of the canvas shows the old and the new render side by side for a moment, which a strict locator refuses. */
export async function single(loc: Locator): Promise<Locator> {
  await expect(loc).toHaveCount(1, { timeout: 30_000 })
  return loc
}

/** The canvas element reads `text` once the redraw has settled to that one element (a plain toHaveText fails on the two renders). */
export const expectOneText = (loc: Locator, text: string, timeout = 30_000) => expect.poll(() => loc.allTextContents(), { timeout }).toEqual([text])

export const expectSaved = (page: Page) => expect(page.locator('[data-site-editor] span[role="status"]')).toHaveText('Saved to draft', { timeout: 20_000 })

type DraftBlock = { type: string; props: Record<string, unknown> }
/** The draft's desktop home page as saved. */
export async function draftHome(page: Page, s: Seeded): Promise<{ blocks: Record<string, DraftBlock>; order: string[] }> {
  const res = await page.request.get(`${ADMIN_BASE}/api/admin/site-builder/drafts/${s.draftId}/editor?key=${encodeURIComponent('store:web:home:')}`)
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { doc: { blocks: Record<string, DraftBlock>; order: string[] } }).doc
}
