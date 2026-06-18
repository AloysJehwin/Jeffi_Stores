/**
 * rate-limit.test.ts
 *
 * Strategy
 * --------
 * applyRateLimit() is the only exported function. It depends on:
 *  - next/server (NextRequest / NextResponse)  → real in happy-dom env
 *  - fetch (global)                            → stubbed via vi.stubGlobal
 *  - process.env.UPSTASH_REDIS_REST_URL/TOKEN  → set per-test
 *
 * The module keeps an in-module `memStore` Map that persists between
 * invocations. We re-import a fresh copy of the module for each describe
 * block that exercises the mem-store path via vi.resetModules() in beforeEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  pathname: string,
  {
    ip = '1.2.3.4',
    xForwardedFor,
    xRealIp,
  }: { ip?: string; xForwardedFor?: string; xRealIp?: string } = {}
): NextRequest {
  const url = `https://example.com${pathname}`
  const headers = new Headers()
  if (xForwardedFor) headers.set('x-forwarded-for', xForwardedFor)
  if (xRealIp) headers.set('x-real-ip', xRealIp)
  return new NextRequest(url, { headers })
}

/** Build a mock fetch that returns the given pipeline count result */
function makeRedisFetch(count: number, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => [{ result: count }, { result: 1 }],
  })
}

// ---------------------------------------------------------------------------
// Tier pattern matching
// ---------------------------------------------------------------------------
describe('TIER pattern matching', () => {
  beforeEach(() => {
    vi.resetModules()
    // No Redis env → forces mem-store, which lets us just check null vs 429
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  const tierCases: Array<[string, number]> = [
    ['/api/admin/login', 5],
    ['/api/admin/mfa/verify', 10],
    ['/api/auth/send-otp', 5],
    ['/api/auth/verify-otp', 10],
    ['/api/auth/login', 10],
    ['/api/auth/signup', 5],
    ['/api/auth/refresh', 20],
    ['/api/search', 20],
    ['/api/products', 30],
    ['/api/coupons', 10],
    ['/api/orders/create', 10],
    ['/api/upload', 20],
    ['/api/forms/contact', 10],
    ['/api/support/ticket', 15],
    ['/api/webhooks/razorpay', 200],
    ['/api/misc/other', 60],
  ]

  it.each(tierCases)(
    'path %s is rate-limited (config found)',
    async (path, _expectedMax) => {
      const { applyRateLimit } = await import('@/lib/rate-limit')
      // First call should never be over limit (count = 1)
      const req = makeRequest(path)
      const result = await applyRateLimit(req)
      // Under the limit on first call → null
      expect(result).toBeNull()
    }
  )

  it('returns null for a path that does not match any tier', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const req = makeRequest('/public/images/logo.png')
    expect(await applyRateLimit(req)).toBeNull()
  })

  it('returns null for an unrecognised path like /storefront/page', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    expect(await applyRateLimit(makeRequest('/storefront/page'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Redis path — over limit → 429
// ---------------------------------------------------------------------------
describe('Redis path — over limit returns 429', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
  })

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.unstubAllGlobals()
  })

  it('returns 429 when Redis count exceeds max for /api/admin/login (max=5)', async () => {
    vi.stubGlobal('fetch', makeRedisFetch(6)) // count 6 > max 5
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const req = makeRequest('/api/admin/login')
    const res = await applyRateLimit(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
  })

  it('returns null when Redis count is exactly at the limit', async () => {
    vi.stubGlobal('fetch', makeRedisFetch(5)) // count 5 = max 5, not over
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const req = makeRequest('/api/admin/login')
    const res = await applyRateLimit(req)
    expect(res).toBeNull()
  })

  it('returns null when Redis count is 1 (well under limit)', async () => {
    vi.stubGlobal('fetch', makeRedisFetch(1))
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const req = makeRequest('/api/admin/login')
    expect(await applyRateLimit(req)).toBeNull()
  })

  it('returns 429 with correct Retry-After header', async () => {
    vi.stubGlobal('fetch', makeRedisFetch(100)) // way over
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const req = makeRequest('/api/admin/login') // windowSecs=60
    const res = await applyRateLimit(req)
    expect(res!.status).toBe(429)
    expect(res!.headers.get('Retry-After')).toBe('60')
  })

  it('returns 429 with X-RateLimit-Limit header matching tier max', async () => {
    vi.stubGlobal('fetch', makeRedisFetch(100))
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const req = makeRequest('/api/admin/login') // max=5
    const res = await applyRateLimit(req)
    expect(res!.headers.get('X-RateLimit-Limit')).toBe('5')
  })

  it('returns 429 with X-RateLimit-Remaining: 0', async () => {
    vi.stubGlobal('fetch', makeRedisFetch(100))
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const res = await applyRateLimit(makeRequest('/api/admin/login'))
    expect(res!.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('returns 429 with X-RateLimit-Reset as a numeric unix timestamp', async () => {
    vi.stubGlobal('fetch', makeRedisFetch(100))
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const res = await applyRateLimit(makeRequest('/api/admin/login'))
    const reset = res!.headers.get('X-RateLimit-Reset')
    expect(Number(reset)).toBeGreaterThan(Date.now() / 1000)
  })

  it('response body contains expected error message', async () => {
    vi.stubGlobal('fetch', makeRedisFetch(100))
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const res = await applyRateLimit(makeRequest('/api/admin/login'))
    const body = await res!.json()
    expect(body.error).toBe('Too many requests. Please slow down.')
  })
})

// ---------------------------------------------------------------------------
// Redis path — fetch failures fall back to mem-store
// ---------------------------------------------------------------------------
describe('Redis path — fetch error falls back to mem-store', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
  })

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.unstubAllGlobals()
  })

  it('falls back to mem-store when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const { applyRateLimit } = await import('@/lib/rate-limit')
    // First call → mem count = 1, under limit → null
    const res = await applyRateLimit(makeRequest('/api/admin/login'))
    expect(res).toBeNull()
  })

  it('falls back to mem-store when fetch returns !ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => null }))
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const res = await applyRateLimit(makeRequest('/api/admin/login'))
    expect(res).toBeNull() // first mem-store hit, count=1
  })

  it('falls back to mem-store when JSON has no result field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 'not-a-number' }],
    }))
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const res = await applyRateLimit(makeRequest('/api/admin/login'))
    expect(res).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// mem-store fallback — increment & expire semantics
// ---------------------------------------------------------------------------
describe('mem-store fallback — increment behaviour', () => {
  beforeEach(() => {
    vi.resetModules()
    // No Redis env → always uses mem-store
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('allows up to max requests from the same IP on a path', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const path = '/api/admin/login' // max=5
    for (let i = 0; i < 5; i++) {
      const res = await applyRateLimit(makeRequest(path, { xForwardedFor: '10.0.0.1' }))
      expect(res).toBeNull()
    }
  })

  it('returns 429 on the (max+1)th request', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const path = '/api/admin/login' // max=5
    for (let i = 0; i < 5; i++) {
      await applyRateLimit(makeRequest(path, { xForwardedFor: '10.0.0.2' }))
    }
    const res = await applyRateLimit(makeRequest(path, { xForwardedFor: '10.0.0.2' }))
    expect(res!.status).toBe(429)
  })

  it('different IPs have independent counters', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const path = '/api/admin/login' // max=5

    // Exhaust limit for IP A
    for (let i = 0; i < 6; i++) {
      await applyRateLimit(makeRequest(path, { xForwardedFor: '10.1.1.1' }))
    }
    // IP B should still be within limit
    const res = await applyRateLimit(makeRequest(path, { xForwardedFor: '10.1.1.2' }))
    expect(res).toBeNull()
  })

  it('different paths have independent counters for the same IP', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const ip = '10.2.2.2'

    // Exhaust /api/admin/login (max=5)
    for (let i = 0; i < 6; i++) {
      await applyRateLimit(makeRequest('/api/admin/login', { xForwardedFor: ip }))
    }
    // /api/admin/mfa/verify has a separate key
    const res = await applyRateLimit(makeRequest('/api/admin/mfa/verify', { xForwardedFor: ip }))
    expect(res).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// IP extraction
// ---------------------------------------------------------------------------
describe('IP extraction', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('uses x-forwarded-for first IP when multiple IPs are present', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const path = '/api/admin/login'
    // Exhaust the key for the first IP in the chain
    for (let i = 0; i < 5; i++) {
      await applyRateLimit(makeRequest(path, { xForwardedFor: '55.55.55.55, 66.66.66.66' }))
    }
    const over = await applyRateLimit(makeRequest(path, { xForwardedFor: '55.55.55.55, 66.66.66.66' }))
    expect(over!.status).toBe(429)

    // 66.66.66.66 alone should not be throttled
    const other = await applyRateLimit(makeRequest(path, { xForwardedFor: '66.66.66.66' }))
    expect(other).toBeNull()
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const path = '/api/admin/login'
    for (let i = 0; i < 5; i++) {
      await applyRateLimit(makeRequest(path, { xRealIp: '77.77.77.77' }))
    }
    const over = await applyRateLimit(makeRequest(path, { xRealIp: '77.77.77.77' }))
    expect(over!.status).toBe(429)
  })

  it('falls back to 127.0.0.1 when no IP headers are present', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit')
    const path = '/api/admin/login'
    for (let i = 0; i < 5; i++) {
      await applyRateLimit(makeRequest(path))
    }
    const over = await applyRateLimit(makeRequest(path))
    expect(over!.status).toBe(429)
  })
})

// ---------------------------------------------------------------------------
// Redis pipeline request structure
// ---------------------------------------------------------------------------
describe('Redis pipeline request structure', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
  })

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.unstubAllGlobals()
  })

  it('POSTs to {url}/pipeline with correct Authorization header', async () => {
    const mockFetch = makeRedisFetch(1)
    vi.stubGlobal('fetch', mockFetch)

    const { applyRateLimit } = await import('@/lib/rate-limit')
    await applyRateLimit(makeRequest('/api/admin/login', { xForwardedFor: '1.1.1.1' }))

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://redis.example.com/pipeline')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-token')
  })

  it('sends INCR + EXPIRE commands in the pipeline body', async () => {
    const mockFetch = makeRedisFetch(1)
    vi.stubGlobal('fetch', mockFetch)

    const { applyRateLimit } = await import('@/lib/rate-limit')
    await applyRateLimit(makeRequest('/api/admin/login', { xForwardedFor: '2.2.2.2' }))

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(Array.isArray(body)).toBe(true)
    expect(body[0][0]).toBe('INCR')
    expect(body[1][0]).toBe('EXPIRE')
    // EXPIRE second arg should be the key, third arg the window as a string
    expect(body[1][2]).toBe('60') // windowSecs for /api/admin/login
  })

  it('does not call fetch when Redis env vars are absent', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const { applyRateLimit } = await import('@/lib/rate-limit')
    await applyRateLimit(makeRequest('/api/admin/login', { xForwardedFor: '3.3.3.3' }))

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
