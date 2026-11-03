import { describe, it, expect, vi } from 'vitest'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'

// Mock NextRequest cookie access
function makeNextRequest(headers: Record<string, string> = {}, fpHashCookie?: string) {
  const h = new Headers(headers)
  return {
    headers: h,
    cookies: {
      get: (name: string) => (name === 'fp_hash' && fpHashCookie ? { value: fpHashCookie } : undefined),
    },
  } as any
}

// Plain Request (no .cookies property on the prototype)
function makePlainRequest(headers: Record<string, string> = {}, cookieHeader?: string) {
  const h = new Headers({ ...headers, ...(cookieHeader ? { cookie: cookieHeader } : {}) })
  return { headers: h } as any
}

describe('extractSessionSignals', () => {
  it('reads all signals from a NextRequest with cookies', () => {
    const req = makeNextRequest(
      {
        'user-agent': 'Chrome/120',
        'accept-language': 'en-US,en;q=0.9',
        'sec-ch-ua-platform': '"macOS"',
        'x-forwarded-for': '203.0.113.5',
      },
      'abc123'
    )

    const s = extractSessionSignals(req)
    expect(s.userAgent).toBe('Chrome/120')
    expect(s.acceptLanguage).toBe('en-US,en;q=0.9')
    expect(s.uaPlatform).toBe('"macOS"')
    expect(s.ip).toBe('203.0.113.5')
    expect(s.fpHash).toBe('abc123')
  })

  it('returns nulls when no headers present (NextRequest)', () => {
    const req = makeNextRequest()
    const s = extractSessionSignals(req)
    expect(s.userAgent).toBeNull()
    expect(s.acceptLanguage).toBeNull()
    expect(s.uaPlatform).toBeNull()
    expect(s.ip).toBeNull()
    expect(s.fpHash).toBeNull()
  })

  it('reads fp_hash from Cookie header on a plain Request', () => {
    const req = makePlainRequest(
      { 'user-agent': 'Safari/17', 'x-forwarded-for': '10.0.0.1' },
      'fp_hash=deadbeef; session_id=abc'
    )
    const s = extractSessionSignals(req)
    expect(s.userAgent).toBe('Safari/17')
    expect(s.ip).toBe('10.0.0.1')
    expect(s.fpHash).toBe('deadbeef')
  })

  it('returns null fp_hash on plain Request with no Cookie header', () => {
    const req = makePlainRequest({ 'user-agent': 'Firefox/120' })
    expect(extractSessionSignals(req).fpHash).toBeNull()
  })

  it('returns null fp_hash on plain Request when fp_hash not in Cookie', () => {
    const req = makePlainRequest({}, 'session_id=xyz; other=val')
    expect(extractSessionSignals(req).fpHash).toBeNull()
  })

  it('decodes URI-encoded fp_hash value', () => {
    const req = makePlainRequest({}, 'fp_hash=dead%20beef')
    expect(extractSessionSignals(req).fpHash).toBe('dead beef')
  })
})
