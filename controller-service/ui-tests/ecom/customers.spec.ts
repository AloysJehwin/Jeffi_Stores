// Browser UI tests for the controller's platform console: the ecom customers overview and list. The session comes
// from tests/ui-kit/global-setup.ts (admin_sid, role administrator: /admin/ecom is platform-only).
//   UI_APP=controller npx playwright test -c playwright.ui.config.ts controller-service/ui-tests/ecom
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'
import { storageStatePath } from '../../../tests/ui-kit/session'

test.use({ storageState: storageStatePath('controller') })

test.describe('controller ecom console (UI)', () => {
  test('customers overview tab renders', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/admin/ecom/customers?tab=overview')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible()
    await expect(page.getByText('Stores and API (Messaging / Documents) workspaces')).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })

  test('customers list tab renders', async ({ page }) => {
    const errors = watchPageErrors(page)
    await page.goto('/admin/ecom/customers?tab=list')
    await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible()
    await expect(page.getByText('Monthly Recurring Revenue')).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
