// Live storefront smoke. LIVE_URL = the platform storefront (https://jeffistores.in); STORE_URL = one tenant
// store host (the probe store). RELEASE_SHA, when set, must equal the commit /api/health reports.
import { test, expect } from '@playwright/test'
import { expectHealthy, expectLivePage } from './_shared'

test.describe('live storefront', () => {
  test.skip(!process.env.LIVE_URL, 'LIVE_URL not set')

  test('health reports the release commit', async ({ request, baseURL }) => {
    await expectHealthy(request, `${baseURL}/api/health`)
  })

  test('home renders and is visible', async ({ page }) => {
    await expectLivePage(page, '/')
  })

  test('product listing renders a grid', async ({ page }) => {
    await expectLivePage(page, '/products')
    await expect(page.locator('a[href^="/products/"]').first()).toBeVisible()
  })

  test('a tenant store renders and is visible', async ({ page, request }) => {
    const store = process.env.STORE_URL?.replace(/\/$/, '')
    test.skip(!store, 'STORE_URL not set')
    await expectHealthy(request, `${store}/api/health`)
    await expectLivePage(page, store!)
  })
})
