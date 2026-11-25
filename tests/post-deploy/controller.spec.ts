// Live control plane (https://ecom.jeffistores.in): anonymous visitors land on its sign-in.
import { test } from '@playwright/test'
import { expectHealthy, expectLivePage, expectUsableInput } from './_shared'

test.describe('live controller', () => {
  test.skip(!process.env.LIVE_URL, 'LIVE_URL not set')

  test('health reports the release commit', async ({ request, baseURL }) => {
    await expectHealthy(request, `${baseURL}/api/health`)
  })

  test('sign-in is visible and usable', async ({ page }) => {
    await expectLivePage(page, '/')
    await expectUsableInput(page)
  })
})
