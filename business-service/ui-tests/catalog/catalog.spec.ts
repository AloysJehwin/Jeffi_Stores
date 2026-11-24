// Browser UI test for the signed-in business catalog. The session comes from tests/ui-kit/global-setup.ts
// (business_sid for the approved uitest-business@jeffi.test account in scripts/seed-test-db.sql).
//   UI_APP=business npx playwright test -c playwright.ui.config.ts business-service/ui-tests/catalog
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'
import { storageStatePath } from '../../../tests/ui-kit/session'

test.use({ storageState: storageStatePath('business') })

// The portal layout asks /api/business/me who is signed in. That route is storefront-service's (the ingress sends
// every other /api/ there), and only this app runs here, so it answers with the seeded account.
const ME = {
  user: {
    id: '00000000-0000-4000-a000-0000000000d1',
    email: 'uitest-business@jeffi.test',
    firstName: 'UI',
    lastName: 'Business',
    isBusiness: true,
    approvalStatus: 'approved',
    companyName: 'UI Test Traders',
    businessDiscountMap: {},
    requiresPolicyAcceptance: false,
  },
}

test.describe('business catalog (UI)', () => {
  test('an approved business sees the catalog', async ({ page }) => {
    const errors = watchPageErrors(page)
    await page.route('**/api/business/me', route => route.fulfill({ json: ME }))
    const res = await page.goto('/business/catalog')
    expect(res?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/business\/catalog/)
    await expect(page.getByRole('heading', { name: 'Product Catalog' })).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
