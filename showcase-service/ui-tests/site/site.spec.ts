// Browser UI test for one seeded Showcase site. Showcase is host-routed, so the site opens on
// site-<slug>.localhost (Chromium resolves *.localhost to loopback). scripts/seed-test-db.sql seeds
// site-ui-test-studio as a paused site, which draws the business name and a note without a compiled page.
//   UI_APP=showcase npx playwright test -c playwright.ui.config.ts showcase-service/ui-tests/site
import { test, expect } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../../../tests/ui-kit/visible'

const PORT = new URL(process.env.UI_BASE_URL || 'http://localhost:3014').port || '3014'

test.use({ baseURL: `http://site-ui-test-studio.localhost:${PORT}` })

test.describe('showcase site (UI)', () => {
  test('a seeded site opens by its host', async ({ page }) => {
    const errors = watchPageErrors(page)
    const res = await page.goto('/')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'UI Test Studio' })).toBeVisible()
    await expect(page.getByText('This site is taking a short break.')).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })

  test('an unknown site host shows the no-site page', async ({ page }) => {
    const errors = watchPageErrors(page)
    await page.goto(`http://site-no-such-site.localhost:${PORT}/`)
    await expect(page.getByRole('heading', { name: 'There is no site here' })).toBeVisible()
    await expectPageVisible(page)
    expect(errors()).toEqual([])
  })
})
