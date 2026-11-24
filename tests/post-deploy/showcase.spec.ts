// Live showcase site. Host-routed: any https://site-<slug>.jeffistores.in answers /api/health; a seeded site
// renders. SHOWCASE_URL (else LIVE_URL) is one such host.
import { test } from '@playwright/test'
import { expectHealthy, expectLivePage } from './_shared'

const base = (process.env.SHOWCASE_URL || process.env.LIVE_URL)?.replace(/\/$/, '')

test.describe('live showcase', () => {
  test.skip(!base, 'SHOWCASE_URL / LIVE_URL not set')

  test('health reports the release commit', async ({ request }) => {
    await expectHealthy(request, `${base}/api/health`)
  })

  test('the site renders and is visible', async ({ page }) => {
    await expectLivePage(page, base!)
  })
})
