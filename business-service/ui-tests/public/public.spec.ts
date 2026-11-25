// Browser UI tests for the business portal's public pages (anonymous). Needs the business app at UI_BASE_URL (default :3012).
//   UI_APP=business npx playwright test -c playwright.ui.config.ts business-service/ui-tests/public
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'

test.describe('business public pages (UI)', () => {
  test('the landing page shows the pitch', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/business')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Industrial supplies')
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })

  test('the signup page opens on the account step', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/business/signup')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'Business Sign Up' })).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
