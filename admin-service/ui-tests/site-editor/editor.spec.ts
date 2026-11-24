// The visual editor in the admin Site Builder end to end (docs/plans/SITE_EDITOR_PLAN.md phase 6): with
// site_editor_enabled on it is the main editor; a change typed on the canvas autosaves to the draft and undoes; a
// classic block opens its fields and converts; "Classic editor" shows the forms and "Visual editor" comes back.
// Needs the admin and the storefront on one origin (the dev router, :3000), as the editor's canvas does:
//   SITE_EDITOR_E2E=1 UI_BASE_URL=http://localhost:3000 npx playwright test --config playwright.ui.config.ts admin-service/ui-tests/site-editor
import { test, expect, type Page } from '@playwright/test'
import { ADMIN_BASE, E2E_ON, E2E_SKIP, HERO_HEADING, seedDown, seedUp, type Seeded } from '../../../tests/site-editor/e2e'

test.describe('visual editor in the Site Builder (UI)', () => {
  test.skip(!E2E_ON, E2E_SKIP)
  test.describe.configure({ mode: 'serial' })
  let s: Seeded
  test.beforeAll(() => {
    s = seedUp()
  })
  test.afterAll(() => seedDown())
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'admin_sid', value: s.sid, url: ADMIN_BASE }])
  })

  /** The seeded draft in the Site Builder, open in the visual editor. */
  async function open(page: Page) {
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
    await expect(frame.locator(`[data-block-id="${s.blocks.hero}"] h1`)).toBeVisible({ timeout: 30_000 })
    return frame
  }
  const saved = (page: Page) => expect(page.locator('[data-site-editor] span[role="status"]')).toHaveText('Saved to draft', { timeout: 20_000 })
  async function draftHome(page: Page) {
    const key = encodeURIComponent('store:web:home:')
    const res = await page.request.get(`${ADMIN_BASE}/api/admin/site-builder/drafts/${s.draftId}/editor?key=${key}`)
    expect(res.ok()).toBe(true)
    return ((await res.json()) as { doc: { blocks: Record<string, { type: string; props: Record<string, unknown> }> } }).doc
  }

  test('opens the draft in the visual editor, saves a change typed on the page, and undoes it', async ({ page }) => {
    const frame = await open(page)
    await expect(page.getByRole('button', { name: 'Classic editor' })).toBeVisible()
    const heading = frame.locator(`[data-block-id="${s.blocks.hero}"] h1`)
    await heading.dblclick()
    await page.keyboard.type('Handmade in Chennai')
    await page.keyboard.press('Enter')
    await saved(page)
    expect(JSON.stringify((await draftHome(page)).blocks[s.blocks.hero].props.tree)).toContain('Handmade in Chennai')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(heading).toHaveText(HERO_HEADING)
    await saved(page)
    expect(JSON.stringify((await draftHome(page)).blocks[s.blocks.hero].props.tree)).toContain(HERO_HEADING)
  })

  test('opens a classic block’s fields, converts it to an editable section, and keeps its words', async ({ page }) => {
    const frame = await open(page)
    await frame.locator(`[data-block-id="${s.blocks.classic}"]`).click()
    await expect(page.getByText(/A classic block: it moves and goes as one piece/)).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Layers' }).getByText('Classic', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Convert to editable section' }).click()
    await saved(page)
    const block = (await draftHome(page)).blocks[s.blocks.classic]
    expect(block.type).toBe('code_section')
    expect(JSON.stringify(block.props.tree)).toContain('A classic block')
    await expect(frame.locator(`[data-block-id="${s.blocks.classic}"] h2`)).toHaveText('A classic block', { timeout: 30_000 })
  })

  test('the classic editor is a fallback: the forms, then back to the visual editor', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Classic editor' }).click()
    await expect(page.getByRole('button', { name: 'Visual editor' })).toBeVisible()
    await expect(page.getByTitle('Page canvas')).toHaveCount(0)
    await page.getByRole('button', { name: 'Visual editor' }).click()
    await expect(page.getByTitle('Page canvas')).toBeVisible({ timeout: 30_000 })
  })
})
