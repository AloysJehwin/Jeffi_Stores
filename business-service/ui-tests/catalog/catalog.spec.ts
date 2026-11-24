// Browser UI test for the signed-in business catalog. The session comes from tests/ui-kit/global-setup.ts
// (business_sid for the approved uitest-business@jeffi.test account in scripts/seed-test-db.sql).
//   UI_APP=business npx playwright test -c playwright.ui.config.ts business-service/ui-tests/catalog
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'
import { storageStatePath } from '../../../tests/ui-kit/session'

test.use({ storageState: storageStatePath('business') })

test.describe('business catalog (UI)', () => {
  test('an approved business sees the catalog', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/business/catalog')
    expect(res?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/business\/catalog/)
    await expect(page.getByRole('heading', { name: 'Product Catalog' })).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
