// The visual editor in the admin Site Builder end to end (docs/plans/SITE_EDITOR_PLAN.md phase 6): with
// site_editor_enabled on it is the main editor; a change typed on the canvas autosaves to the draft and undoes; a
// classic block opens its fields and converts; "Classic editor" shows the forms and "Visual editor" comes back.
// Needs the admin and the storefront on one origin (the dev router, :3000), as the editor's canvas does:
//   SITE_EDITOR_E2E=1 UI_BASE_URL=http://localhost:3000 npx playwright test --config playwright.ui.config.ts admin-service/ui-tests/site-editor
import { test, expect, type Page } from '@playwright/test'
import { E2E_ON, E2E_SKIP, HERO_HEADING, draftHome, expectOneText, expectSaved, single, adminPage, openEditor, seedDown, seedUp, type Seeded } from '../../../tests/site-editor/e2e'

test.describe('visual editor in the Site Builder (UI)', () => {
  test.skip(!E2E_ON, E2E_SKIP)
  test.describe.configure({ mode: 'serial' })
  let s: Seeded
  let page: Page
  // One browser for the file: the seeded admin session binds to the first browser that uses it (session binding).
  test.beforeAll(async ({ browser }) => {
    s = seedUp()
    page = await adminPage(browser, s)
  })
  test.afterAll(async () => {
    await page?.context().close()
    seedDown()
  })

  const open = (page: Page) => openEditor(page, s)
  const saved = expectSaved

  test('opens the draft in the visual editor, saves a change typed on the page, and undoes it', async () => {
    const frame = await open(page)
    await expect(page.getByRole('button', { name: 'Classic editor' })).toBeVisible()
    const heading = frame.locator(`[data-block-id="${s.blocks.hero}"] h1`)
    await (await single(heading)).dblclick()
    await page.keyboard.type('Handmade in Chennai')
    await page.keyboard.press('Enter')
    await saved(page)
    expect(JSON.stringify((await draftHome(page, s)).blocks[s.blocks.hero].props.tree)).toContain('Handmade in Chennai')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expectOneText(heading, HERO_HEADING)
    await saved(page)
    expect(JSON.stringify((await draftHome(page, s)).blocks[s.blocks.hero].props.tree)).toContain(HERO_HEADING)
  })

  test('opens a classic block’s fields, converts it to an editable section, and keeps its words', async () => {
    const frame = await open(page)
    await (await single(frame.locator(`[data-block-id="${s.blocks.classic}"]`))).click()
    await expect(page.getByText(/A classic block: it moves and goes as one piece/)).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Layers' }).getByText('Classic', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Convert to editable section' }).click()
    await saved(page)
    const block = (await draftHome(page, s)).blocks[s.blocks.classic]
    expect(block.type).toBe('code_section')
    expect(JSON.stringify(block.props.tree)).toContain('A classic block')
    await expectOneText(frame.locator(`[data-block-id="${s.blocks.classic}"] h2`), 'A classic block')
  })

  test('the classic editor is a fallback: the forms, then back to the visual editor', async () => {
    await open(page)
    await page.getByRole('button', { name: 'Classic editor' }).click()
    await expect(page.getByRole('button', { name: 'Visual editor' })).toBeVisible()
    await expect(page.getByTitle('Page canvas')).toHaveCount(0)
    await page.getByRole('button', { name: 'Visual editor' }).click()
    await expect(page.getByTitle('Page canvas')).toBeVisible({ timeout: 30_000 })
  })
})
