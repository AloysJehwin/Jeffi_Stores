import { describe, it, expect } from 'vitest'
import { GET } from '@storefront/app/(auth)/auth/google/callback/route'
import { CALLBACK_HTML } from '@/lib/auth/google-callback-html'

describe('GET /auth/google/callback', () => {
  it('serves the plain-HTML callback uncached with no referrer', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await res.text()).toBe(CALLBACK_HTML)
  })
})
