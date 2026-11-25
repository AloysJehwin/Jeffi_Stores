// Browser UI tests for signed-in admin pages: dashboard, products list, one product editor. The session comes from
// tests/ui-kit/global-setup.ts (admin_sid for the seeded administrator); data from scripts/seed-test-db.sql.
//   UI_APP=admin npx playwright test -c playwright.ui.config.ts admin-service/ui-tests/pages
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'
import { storageStatePath } from '../../../tests/ui-kit/session'

test.use({ storageState: storageStatePath('admin') })

const PRODUCT_ID = '00000000-0000-4000-b000-000000000001'

test.describe('admin signed in (UI)', () => {
  test('dashboard greets the administrator', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/admin/dashboard')
    expect(res?.status()).toBeLessThan(400)
    await expect(page).not.toHaveURL(/\/admin\/login/)
    await expect(page.getByRole('heading', { name: 'Store analytics' })).toBeVisible()
    await expect(page.getByText(/^Welcome back, /)).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })

  test('products list renders', async ({ page }) => {
    const errors = watchPageErrors(page)
    await page.goto('/admin/products')
    await expect(page).not.toHaveURL(/\/admin\/login/)
    await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible()
    await expect(page.getByText('Manage your product inventory')).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })

  // A live product is edited through a draft: /edit without one redirects to the product, which redirects to /view.
  test('the product page shows the seeded product', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto(`/admin/products/${PRODUCT_ID}/view`)
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'API Test Bolt' })).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
