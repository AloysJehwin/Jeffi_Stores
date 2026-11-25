// Self-test for expectPageVisible: no server, pages come from setContent. Run with UI_APP=kit.
import { test, expect } from '@playwright/test'
import { expectPageVisible } from './visible'

const STYLE = `<style>html,body{margin:0}.pointer-events-none{pointer-events:none}</style>`
const APP = `<div data-app-root style="min-height:100vh;background:#fff"><header style="height:80px;background:#1f2937;color:#fff">Shop</header><main style="padding:24px"><h1>Products</h1><div style="width:300px;height:200px;background:#2563eb"></div></main></div>`

test.describe('expectPageVisible', () => {
  test('a normal page passes', async ({ page }) => {
    await page.setContent(`${STYLE}${APP}`)
    await expectPageVisible(page)
  })

  test('PR #636: an opaque pointer-events:none layer before the app root fails', async ({ page }) => {
    await page.setContent(`${STYLE}<div class="pointer-events-none" style="position:fixed;inset:0;z-index:70;background:#f9fafb"></div>${APP}`)
    await expect(expectPageVisible(page)).rejects.toThrow(/opaque full-screen layer/)
  })

  test('a partial pointer-events:none layer fails the hit test', async ({ page }) => {
    await page.setContent(`${STYLE}${APP}<div class="pointer-events-none" style="position:fixed;left:0;top:0;width:100%;height:60%;z-index:5;background:rgba(255,0,0,.6)"></div>`)
    await expect(expectPageVisible(page)).rejects.toThrow(/pointer-events:none layer covers/)
  })

  test('an all-white page fails', async ({ page }) => {
    await page.setContent(`${STYLE}<div data-app-root style="min-height:100vh;background:#fff"></div>`)
    await expect(expectPageVisible(page)).rejects.toThrow(/blank/)
  })

  test('an open dialog with a sibling backdrop passes', async ({ page }) => {
    await page.setContent(`${STYLE}${APP}<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50"></div><div role="dialog" aria-modal="true" style="position:fixed;left:50%;top:50%;width:300px;height:160px;margin:-80px 0 0 -150px;background:#fff;z-index:51">Cart</div>`)
    await expectPageVisible(page)
  })

  test('a page with no app root fails', async ({ page }) => {
    await page.setContent(`${STYLE}<div style="height:100vh;background:#2563eb"></div>`)
    await expect(expectPageVisible(page)).rejects.toThrow(/data-app-root/)
  })

  test('opts.allow lets an extra top element through', async ({ page }) => {
    await page.setContent(`${STYLE}${APP}<div id="consent" style="position:fixed;left:0;right:0;bottom:0;height:60px;background:#111;z-index:9">cookies</div>`)
    await expect(expectPageVisible(page)).rejects.toThrow(/consent/)
    await expectPageVisible(page, { allow: ['#consent'] })
  })
})
