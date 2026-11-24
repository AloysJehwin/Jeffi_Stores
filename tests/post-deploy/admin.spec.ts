// Live admin login page. The platform admin host sits behind a client-certificate gate, so CI sets ADMIN_URL
// only to a host it can reach (e.g. a store's own admin host); LIVE_URL is used otherwise.
import { test } from '@playwright/test'
import { expectLivePage, expectUsableInput } from './_shared'

const base = (process.env.ADMIN_URL || process.env.LIVE_URL)?.replace(/\/$/, '')

test.describe('live admin', () => {
  test.skip(!base, 'ADMIN_URL / LIVE_URL not set')

  test('login page is visible and usable', async ({ page }) => {
    await expectLivePage(page, `${base}/admin/login`)
    await expectUsableInput(page)
  })
})
