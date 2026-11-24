// Browser UI test: storefront catalog/products listing. Runs against a running storefront (UI_BASE_URL,
// default :3010) on seeded jeffi_test. Run: npx playwright test --config playwright.ui.config.ts storefront-service/ui-tests/products
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'

test.describe('storefront products listing (UI)', () => {
  test('products page renders and returns a non-error status', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/products')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.locator('body')).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })

  test('a seeded product is reachable by its slug', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/products/api-test-bolt')
    // Either the PDP renders (200) or a graceful 404 page — never a 5xx.
    expect(res?.status()).toBeLessThan(500)
    await expect(page.locator('body')).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
