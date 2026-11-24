// Browser UI test: add a seeded product to the cart and check the page is still visible after the
// fly-to-cart animation (the PR #636 overlay blanked the page here). Seeded by scripts/seed-test-db.sql.
// Run: UI_APP=storefront npx playwright test -c playwright.ui.config.ts storefront-service/ui-tests/cart
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'

test.describe('storefront add to cart (UI)', () => {
  test('page stays visible after the fly-to-cart animation', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/products/api-test-bolt')
    expect(res?.status()).toBeLessThan(400)
    await expectPageVisible(page)

    await page.getByRole('button', { name: /add to cart/i }).first().click()
    await page.waitForTimeout(1500)

    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
