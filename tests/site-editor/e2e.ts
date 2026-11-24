// Shared by the visual editor's end-to-end specs (storefront-service/ui-tests/site-editor, admin-service/ui-tests/
// site-editor): the seed (seed.ts, under tsx, since it reaches store-core) and the canvas message log. Opt in with
// SITE_EDITOR_E2E=1: they switch site_editor_enabled on and write drafts, on jeffi_test only.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'

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
  execFileSync(path.join('node_modules', '.bin', 'tsx'), ['--tsconfig', 'tests/responsive/tsconfig.sweep.json', 'tests/site-editor/seed.ts', cmd], { stdio: 'inherit' })
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
