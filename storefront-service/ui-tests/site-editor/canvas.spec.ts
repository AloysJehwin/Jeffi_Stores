// The visual editor's canvas end to end (docs/plans/SITE_EDITOR_PLAN.md phase 6): the storefront renders a seeded
// draft with a preview token inside a frame, as the editor shows it, and the canvas bridge answers the editor's
// messages (components/visitor/site/editor/SiteEditorBridge.tsx). A live page carries none of it.
//   SITE_EDITOR_E2E=1 npx playwright test --config playwright.ui.config.ts storefront-service/ui-tests/site-editor
import { test, expect, type Page } from '@playwright/test'
import { E2E_ON, E2E_SKIP, HERO_HEADING, LOG_SCRIPT, STORE_BASE, clearMessages, nextMessage, seedDown, seedUp, type Seeded } from '../../../tests/site-editor/e2e'

test.describe('site editor canvas (UI)', () => {
  test.skip(!E2E_ON, E2E_SKIP)
  test.describe.configure({ mode: 'serial' })
  let s: Seeded
  test.beforeAll(() => {
    s = seedUp()
  })
  test.afterAll(() => seedDown())

  /** The draft in a frame of the editor's width, the bridge ready and switched on. */
  async function canvas(page: Page, width = 1280) {
    await page.setViewportSize({ width: width + 40, height: 1000 })
    const src = `${STORE_BASE}/?preview=${encodeURIComponent(s.token)}&layout=${width < 768 ? 'mobile' : 'desktop'}`
    await page.setContent(`<!doctype html><html><body style="margin:0"><script>${LOG_SCRIPT}</script><iframe id="c" src="${src}" style="width:${width}px;height:960px;border:0"></iframe></body></html>`)
    // The store reads the flag through a 15s cache, so a first load may come before it sees the seed.
    for (let i = 0; ; i++) {
      const ready = await nextMessage(page, 'ready', {}, 8_000).then(
        () => true,
        () => false
      )
      if (ready) break
      if (i === 3) throw new Error('the canvas bridge never said ready: is site_editor_enabled on, and the preview token honoured?')
      await page.evaluate(() => {
        const f = document.getElementById('c') as HTMLIFrameElement
        f.src = f.src
      })
    }
    await page.evaluate(() => (document.getElementById('c') as HTMLIFrameElement).contentWindow!.postMessage({ type: 'site-editor:mode', on: true, write: true }, '*'))
    return page.frameLocator('#c')
  }

  test('selects what is clicked and types in place, reporting the change as a design operation', async ({ page }) => {
    const frame = await canvas(page)
    const heading = frame.locator(`[data-block-id="${s.blocks.hero}"] h1`)
    await expect(heading).toHaveText(HERO_HEADING)
    await clearMessages(page)
    await heading.click()
    const selected = await nextMessage(page, 'select', { block: s.blocks.hero })
    expect(typeof selected.id).toBe('string')
    await expect(heading).toHaveAttribute('data-e-selected', '')

    await heading.dblclick()
    await expect(heading).toHaveAttribute('contenteditable', /plaintext-only|true/)
    await page.keyboard.type('Handmade in Chennai')
    await clearMessages(page)
    await page.keyboard.press('Enter')
    const ops = await nextMessage(page, 'ops', { block: s.blocks.hero })
    expect(ops.ops).toEqual([{ op: 'text', id: selected.id, value: 'Handmade in Chennai' }])
    await expect(heading).toHaveText('Handmade in Chennai')
    await expect(heading).not.toHaveAttribute('contenteditable')
  })

  test('gives a free layer handles and reports where it is dragged, in % of its frame', async ({ page }) => {
    const frame = await canvas(page)
    const badge = frame.locator(`[data-block-id="${s.blocks.hero}"] span`, { hasText: 'New season' })
    await expect(badge).toHaveCSS('position', 'absolute')
    await badge.click()
    await expect(frame.locator('[data-e-overlay]').first()).toBeAttached()
    const box = (await badge.boundingBox())!
    await clearMessages(page)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 + 60, { steps: 10 })
    await page.mouse.up()
    const placed = await nextMessage(page, 'placed', { block: s.blocks.hero })
    const rect = placed.rect as { left: number; top: number; width: number }
    // Placed at left 78% on Desktop (editor-pack.ts); dragged left, it lands further left, still inside its frame.
    expect(rect.left).toBeLessThan(78)
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.top).toBeGreaterThan(2)
  })

  test('keeps a phone placement inside the screen', async ({ page }) => {
    const frame = await canvas(page, 390)
    const hero = frame.locator(`[data-block-id="${s.blocks.hero}"]`)
    const badge = hero.locator('span', { hasText: 'New season' })
    await expect(badge).toHaveCSS('position', 'absolute')
    const [b, h] = [(await badge.boundingBox())!, (await hero.boundingBox())!]
    expect(b.x).toBeGreaterThanOrEqual(h.x - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(h.x + h.width + 1)
  })

  test('a live page ships none of it: no bridge, no node ids, no editing mode', async ({ page }) => {
    const res = await page.goto(`${STORE_BASE}/`)
    expect(res?.status()).toBeLessThan(400)
    expect(await page.evaluate(() => !!(window as unknown as { __siteEditorBridge?: boolean }).__siteEditorBridge)).toBe(false)
    await expect(page.locator('[data-e]')).toHaveCount(0)
    await expect(page.locator('html[data-site-editing]')).toHaveCount(0)
  })
})
