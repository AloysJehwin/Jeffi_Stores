// Live health and one contract assertion for the services without a UI. Each URL comes from env and its test
// skips when unset: MESSAGING_URL, DOCUMENTS_URL, PUBLIC_API_URL, MOBILE_URL (base hosts) and AI_GATEWAY_URL.
import { test, expect } from '@playwright/test'
import { expectHealthy } from './_shared'

const env = (k: string) => process.env[k]?.replace(/\/$/, '')

test.describe('live services', () => {
  test('messaging health', async ({ request }) => {
    test.skip(!env('MESSAGING_URL'), 'MESSAGING_URL not set')
    await expectHealthy(request, `${env('MESSAGING_URL')}/healthz`, '')
  })

  test('documents health', async ({ request }) => {
    test.skip(!env('DOCUMENTS_URL'), 'DOCUMENTS_URL not set')
    await expectHealthy(request, `${env('DOCUMENTS_URL')}/healthz`, '')
  })

  test('public-api health and openapi.json parses', async ({ request }) => {
    test.skip(!env('PUBLIC_API_URL'), 'PUBLIC_API_URL not set')
    await expectHealthy(request, `${env('PUBLIC_API_URL')}/healthz`, '')
    const res = await request.get(`${env('PUBLIC_API_URL')}/openapi.json`)
    expect(res.status()).toBeLessThan(400)
    const spec = await res.json()
    expect(spec.openapi ?? spec.swagger).toBeTruthy()
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(0)
  })

  test('mobile health', async ({ request }) => {
    test.skip(!env('MOBILE_URL'), 'MOBILE_URL not set')
    await expectHealthy(request, `${env('MOBILE_URL')}/healthz`, '')
  })

  test('ai-gateway lists providers', async ({ request }) => {
    test.skip(!env('AI_GATEWAY_URL'), 'AI_GATEWAY_URL not set')
    const res = await request.get(`${env('AI_GATEWAY_URL')}/v1/providers`)
    expect(res.status()).toBeLessThan(400)
    expect(await res.json()).toBeTruthy()
  })
})
