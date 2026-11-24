// Live business portal (https://business.jeffistores.in): public landing and sign-in.
import { test } from '@playwright/test'
import { expectHealthy, expectLivePage, expectUsableInput } from './_shared'

test.describe('live business', () => {
  test.skip(!process.env.LIVE_URL, 'LIVE_URL not set')

  test('health reports the release commit', async ({ request, baseURL }) => {
    await expectHealthy(request, `${baseURL}/api/health`)
  })

  test('landing is visible', async ({ page }) => {
    await expectLivePage(page, '/')
  })

  test('sign-in is visible and usable', async ({ page }) => {
    await expectLivePage(page, '/business/signin')
    await expectUsableInput(page)
  })
})
