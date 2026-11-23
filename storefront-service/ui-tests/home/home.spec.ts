// Browser UI test for the storefront home component. Runs against a running storefront (UI_BASE_URL,
// default :3010) backed by seeded jeffi_test. Run just this component:
//   npx playwright test --config playwright.ui.config.ts storefront-service/ui-tests/home
import { test, expect } from '@playwright/test'

test.describe('storefront home (UI)', () => {
  test('home renders a 200 with the page shell and a title', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.locator('body')).toBeVisible()
    await expect(page).toHaveTitle(/.+/)
  })
})
