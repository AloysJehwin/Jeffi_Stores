// The visual editor's AI end to end (docs/plans/SITE_EDITOR_PLAN.md phase 4) in the admin Site Builder: "Change with
// AI" on a selection, the cheap element actions, the page check's fixes and "Check screen sizes", and "Design this page
// again" with "Keep my words". The AI is tests/site-editor/ai-mock.ts, so the real routes, prompts and compiler run
// without Claude; start the apps with AI_GATEWAY_URL=http://localhost:8098 (the CI job does).
//   SITE_EDITOR_E2E=1 UI_BASE_URL=http://localhost:3000 npx playwright test --config playwright.ui.config.ts admin-service/ui-tests/site-editor/ai.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { AI_MOCK_PORT, MOCK, startAiMock, type MockCall } from '../../../tests/site-editor/ai-mock'
import { E2E_ON, E2E_SKIP, HERO_HEADING, canvasReady, draftHome, expectOneText, expectSaved, single, adminPage, openEditor, seedDown, seedUp, type Seeded } from '../../../tests/site-editor/e2e'

test.describe('visual editor AI (UI)', () => {
  test.skip(!E2E_ON, E2E_SKIP)
  test.describe.configure({ mode: 'serial' })
  let s: Seeded
  let mock: Awaited<ReturnType<typeof startAiMock>>
  let page: Page
  // One browser for the file: the seeded admin session binds to the first browser that uses it (session binding).
  test.beforeAll(async ({ browser }) => {
    s = seedUp()
    mock = await startAiMock()
    page = await adminPage(browser, s)
  })
  test.afterAll(async () => {
    await page?.context().close()
    await mock?.close()
    seedDown()
  })

  const status = (page: Page) => page.locator('[data-site-editor] span[role="status"]')
  /** Fails with the reason when the apps don't reach the mock. */
  async function noAiError(page: Page) {
    const t = (await status(page).textContent()) ?? ''
    if (/isn.t available|not reachable/.test(t)) throw new Error(`the AI routes did not reach the mock: start the apps with AI_GATEWAY_URL=http://localhost:${AI_MOCK_PORT} (${t})`)
  }
  const chats = (fn: (c: MockCall) => boolean) => mock.calls.filter(c => c.path === '/v1/chat' && fn(c))
  const said = (c: MockCall, role: string) => (c.body.messages ?? []).filter(m => m.role === role).map(m => m.content).join('\n')
  const tree = async (page: Page, block = s.blocks.hero) => JSON.stringify((await draftHome(page, s)).blocks[block].props.tree)

  test('Change with AI rewrites the selection as one undoable change and lights up what it touched', async () => {
    const frame = await openEditor(page, s)
    const heading = frame.locator(`[data-block-id="${s.blocks.hero}"] h1`)
    await (await single(heading)).click()
    const id = await heading.getAttribute('data-e')
    await page.getByRole('textbox', { name: /^What to change in/ }).fill('Make the heading about our Chennai workshop')
    await page.getByRole('button', { name: 'Change', exact: true }).click()
    await expectOneText(heading, MOCK.changed, 60_000).catch(async e => (await noAiError(page), Promise.reject(e)))
    await expect(frame.locator('[data-e-flash]').first()).toBeAttached()
    // The prompt named the selection and carried the editor's rules.
    const ask = chats(c => said(c, 'user').includes('This is the section "')).pop()
    expect(ask, 'no tweak prompt reached the AI').toBeTruthy()
    expect(said(ask!, 'user')).toContain(`The owner selected <h1 data-e="${id}">`)
    expect(said(ask!, 'user')).toContain('Keep the data-e attribute exactly as it is')
    await expectSaved(page)
    expect(await tree(page)).toContain(MOCK.changed)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expectOneText(heading, HERO_HEADING, 30_000)
    await expectSaved(page)
    expect(await tree(page)).toContain(HERO_HEADING)
  })

  test('element actions rewrite, shorten and translate words, and find a picture for an image slot', async () => {
    const frame = await openEditor(page, s)
    const heading = frame.locator(`[data-block-id="${s.blocks.hero}"] h1`)
    await (await single(heading)).click()
    await page.getByRole('button', { name: 'Rewrite' }).click()
    await expectOneText(heading, MOCK.rewrite, 30_000).catch(async e => (await noAiError(page), Promise.reject(e)))
    await page.getByRole('button', { name: 'Shorten', exact: true }).click()
    await expectOneText(heading, MOCK.shorten, 30_000)
    await page.getByLabel('Translate into').selectOption('Hindi')
    await expectOneText(heading, MOCK.hindi, 30_000)
    expect(chats(c => said(c, 'user').includes('Translate it into Hindi')).length).toBeGreaterThan(0)
    await expectSaved(page)
    expect(await tree(page)).toContain(MOCK.hindi)
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Undo' }).click()
    await expectOneText(heading, HERO_HEADING)
    await expectSaved(page)

    // A picture: the route's stock search and generation run against the mock (nothing found), then a found one as the
    // route returns it (stock copies and generated pictures upload to S3, which a test never does).
    const picture = frame.locator(`[data-block-id="${s.blocks.hero}"] img`).first()
    await canvasReady(frame)
    await picture.click()
    await page.getByRole('button', { name: 'Find a picture for this spot' }).click()
    await expect(status(page)).toHaveText(/No picture came up|could not do that/, { timeout: 30_000 })
    await page.route('**/api/admin/site-builder/ai/element', route =>
      route.fulfill({ json: { url: '/images/Tools.png', alt: 'Tools on a bench', credit: { name: 'A photographer', url: 'https://www.pexels.com/@a', source: 'pexels', pageUrl: 'https://www.pexels.com/photo/1' } } })
    )
    await page.getByRole('button', { name: 'Find a picture for this spot' }).click()
    await expect(picture).toHaveAttribute('src', /Tools/, { timeout: 30_000 })
    await expectSaved(page)
    expect(await tree(page)).toContain('/images/Tools.png')
    await page.unroute('**/api/admin/site-builder/ai/element')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expectSaved(page)
  })

  test('the page check fixes a missing picture description and shortens words with AI', async () => {
    const frame = await openEditor(page, s)
    await frame.locator(`[data-block-id="${s.blocks.hero}"] img`).first().click()
    const alt = page.getByLabel('Description (read aloud)')
    await alt.fill('')
    await alt.press('Enter')
    await page.getByRole('button', { name: /^Check page/ }).click()
    const fixes = page.getByRole('list', { name: 'What to fix' })
    const noAlt = fixes.getByRole('listitem').filter({ hasText: 'has no description' })
    await expect(noAlt).toHaveCount(1)
    await noAlt.getByRole('button', { name: 'Fix' }).click()
    await expect(noAlt).toHaveCount(0)
    await expectSaved(page)
    expect(await tree(page)).toContain(`"alt"`)

    const heading = frame.locator(`[data-block-id="${s.blocks.hero}"] h1`)
    // The fix redraws the canvas after its save.
    await canvasReady(frame)
    await (await single(heading)).dblclick()
    await page.keyboard.type('Made by hand in small batches, packed with care and shipped to every corner of India')
    await page.keyboard.press('Enter')
    const long = fixes.getByRole('listitem').filter({ hasText: 'characters; it may wrap badly' })
    await expect(long).toHaveCount(1)
    await long.getByRole('button', { name: 'Shorten with AI' }).click()
    await expectOneText(heading, MOCK.shorten, 30_000)
    await expect(long).toHaveCount(0)
    await expectSaved(page)
    // Back as seeded: the shortening, the typing, the fix and the cleared description.
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Undo' }).click()
    await expectOneText(heading, HERO_HEADING, 30_000)
    await expectSaved(page)
    expect(await tree(page)).toContain('Our workshop')
  })

  test('Check screen sizes finds what runs past the screen at Phone, Tablet and Desktop', async () => {
    const frame = await openEditor(page, s)
    await page.getByRole('button', { name: /^Check page/ }).click()
    const sizes = page.getByRole('region', { name: 'Screen sizes' })
    await sizes.getByRole('button', { name: /Check screen sizes/ }).click()
    await expect(sizes).toContainText('Nothing runs past the screen', { timeout: 90_000 })

    // The badge placed past the hero's right edge on Desktop: the page now runs wider than the screen there.
    await (await single(frame.locator(`[data-block-id="${s.blocks.hero}"] span`, { hasText: 'New season' }))).click()
    await page.getByLabel('Left (%)').fill('90')
    await page.getByLabel('Left (%)').press('Enter')
    await page.getByLabel('Width (%)').fill('40')
    await page.getByLabel('Width (%)').press('Enter')
    await expectSaved(page)
    await sizes.getByRole('button', { name: /Check screen sizes/ }).click()
    const past = sizes.getByRole('listitem').filter({ hasText: 'Desktop' })
    await expect(past).toHaveCount(1, { timeout: 90_000 })
    await past.getByRole('button', { name: 'Show' }).click()
    await expect(page.getByRole('button', { name: /Desktop/, pressed: true })).toBeVisible()
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Undo' }).click()
    await expectSaved(page)
  })

  test('designing a page changed by hand again asks first and sends the owner’s words with the brief', async () => {
    await openEditor(page, s)
    await page.getByRole('button', { name: 'Classic editor' }).click()
    // The panel's AI tab (the admin's side menu has an AI group before it).
    await page.getByRole('button', { name: 'AI', exact: true }).last().click()
    // The panel's button, then the same words on the confirmation, which asks first: the page was changed by hand.
    await page.getByRole('button', { name: 'Design again' }).click()
    await expect(page.getByText('You changed this page by hand.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Design again' }).last().click()
    const sent = page.waitForRequest(r => r.url().includes('/api/admin/site-builder/ai/page') && r.method() === 'POST')
    await page.getByRole('button', { name: 'Keep my words' }).click()
    expect((await sent).postDataJSON()).toMatchObject({ keepWords: true })
    // The section writer's brief carries the page's words; the mock writes the first back as each section's heading.
    await expect.poll(() => chats(c => /You write ONE section/.test(said(c, 'system')) && said(c, 'user').includes(`"${HERO_HEADING}"`)).length, { timeout: 90_000 }).toBeGreaterThan(0)
    await expect(page.getByText(/Designed again\.|could not design this page again/)).toBeVisible({ timeout: 180_000 })
    await expect(page.getByText(/Designed again\./)).toBeVisible()
    // The page is the new design, written with the first of the kept words.
    // (Change with AI's tweaks share the section writer's system prompt; the redo's calls carry the kept words.)
    const ask = chats(c => /You write ONE section/.test(said(c, 'system')) && said(c, 'user').includes('reuse them as written'))[0]
    const kept = ask && /reuse them as written[^:]*: "([^"]+)"/.exec(said(ask, 'user'))?.[1]
    expect(kept).toBeTruthy()
    const home = await draftHome(page, s)
    expect(home.order).not.toContain(s.blocks.hero)
    expect(JSON.stringify(home)).toContain(kept!)
  })
})
