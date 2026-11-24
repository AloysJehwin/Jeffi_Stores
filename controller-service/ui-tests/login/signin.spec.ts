// Browser UI test for the controller's public sign-in page (anonymous). Needs the controller at UI_BASE_URL (default :3013).
//   UI_APP=controller npx playwright test -c playwright.ui.config.ts controller-service/ui-tests/login
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'

test.describe('controller sign-in (UI)', () => {
  test('the ecom sign-in page renders its pitch', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/ecom/signin')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: /Everything you need to sell online/ })).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
