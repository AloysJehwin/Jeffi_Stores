// Browser UI test: storefront cart page. Runs against a running storefront on seeded jeffi_test.
// Run: npx playwright test --config playwright.ui.config.ts storefront-service/ui-tests/cart
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'

test.describe('storefront cart (UI)', () => {
  test('empty cart page renders for a guest', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/cart')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.locator('body')).toBeVisible()
    // The cart route always renders a page shell (empty-state or items), never blank.
    await expect(page).toHaveTitle(/.+/)
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
