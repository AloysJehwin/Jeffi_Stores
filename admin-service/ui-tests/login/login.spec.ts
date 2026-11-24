// Browser UI test for the admin login page (anonymous). Needs the admin app at UI_BASE_URL (default :3011).
//   UI_APP=admin npx playwright test -c playwright.ui.config.ts admin-service/ui-tests/login
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'

test.describe('admin login (UI)', () => {
  test('the login page shows the admin panel sign-in', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/admin/login')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible()
    await expect(page.getByText('Sign in to access the dashboard')).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })

  test('a signed-out visit to the dashboard lands on the login page', async ({ page }) => {
    const errors = watchPageErrors(page)
    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/admin\/login/)
    await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
