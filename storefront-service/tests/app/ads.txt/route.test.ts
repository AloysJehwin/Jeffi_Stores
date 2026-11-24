import { describe, it, expect } from 'vitest'
import { GET } from '@storefront/app/ads.txt/route'
import { adsTxt } from '@/lib/analytics/adsense'

describe('GET /ads.txt', () => {
  it('authorises the platform AdSense account as plain text, cached for an hour', async () => {
    const res = GET()
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    const body = await res.text()
    expect(body).toBe(adsTxt())
    expect(body).toMatch(/^google\.com, pub-\d+, DIRECT, [0-9a-f]{16}\n$/)
  })
})
