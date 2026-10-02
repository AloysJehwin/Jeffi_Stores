import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Keep every pure helper real (normHost, bindScope, isUnderCookieDomain, mintBindCookie, sidHashOf,
// BIND_COOKIE, …) and only stub the side-effecting collaborators so the route reaches the mint path.
vi.mock('@/lib/auth/session-binding', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/session-binding')>()
  return {
    ...actual,
    bindingMode: vi.fn(() => 'enforce'),
    loadSessionKey: vi.fn(),
    verifyProof: vi.fn(() => ({ ok: true, ts: Date.now() })),
    consumeRefresh: vi.fn(async () => true),
    registerSessionKey: vi.fn(),
    logBinding: vi.fn(),
  }
})
vi.mock('@/lib/auth/auth-sessions', () => ({ resolveSession: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: vi.fn(() => ({ binding: null })) }))

import { POST } from '@/app/api/(public)/auth/rt/route'
import { resolveSession } from '@/lib/auth/auth-sessions'
import { queryOne } from '@/lib/shared/db'
import { loadSessionKey } from '@/lib/auth/session-binding'

const SID = '11111111-1111-4111-8111-111111111111'

function rtRequest(host: string) {
  const req = new NextRequest(`https://${host}/api/auth/rt`, {
    method: 'POST',
    headers: {
      'x-forwarded-host': host,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-session-proof': 'proof',
    },
    body: JSON.stringify({}),
  })
  req.cookies.set('user_sid', SID)
  return req
}

// Pull the Domain attribute off the Set-Cookie line for the customer bind cookie (_vu), or null.
function bindCookieDomain(res: Response): string | null {
  const lines: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  const line = lines.find((l) => l.startsWith('_vu='))
  if (!line) return null
  const m = line.match(/;\s*Domain=([^;]+)/i)
  return m ? m[1].trim() : null
}

let savedNodeEnv: string | undefined
let savedCookieDomain: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  savedNodeEnv = process.env.NODE_ENV
  savedCookieDomain = process.env.COOKIE_DOMAIN
  process.env.SESSION_BINDING_SECRET = 'test-secret'
  process.env.SESSION_BINDING_MODE = 'enforce'
  ;(process.env as Record<string, string>).NODE_ENV = 'production'
  process.env.COOKIE_DOMAIN = '.jeffistores.in'

  vi.mocked(resolveSession).mockResolvedValue({ principalType: 'customer' } as any)
  vi.mocked(queryOne).mockResolvedValue({
    id: 'sess-1',
    created_at: new Date(Date.now() - 60_000).toISOString(),
  } as any)
  // A key already registered on the apex scope → request passes the host-scope check, cookie mints.
  vi.mocked(loadSessionKey).mockResolvedValue({ jwk: {} as any, host: 'jeffistores.in', createdAt: Date.now() })
})

afterEach(() => {
  if (savedNodeEnv === undefined) delete (process.env as Record<string, string>).NODE_ENV
  else (process.env as Record<string, string>).NODE_ENV = savedNodeEnv
  if (savedCookieDomain === undefined) delete process.env.COOKIE_DOMAIN
  else process.env.COOKIE_DOMAIN = savedCookieDomain
})

describe('POST /api/auth/rt — bind cookie Domain attribute', () => {
  it('APEX (jeffistores.in): bind cookie carries Domain=.jeffistores.in (the regression)', async () => {
    const res = await POST(rtRequest('jeffistores.in'))
    expect(res.status).toBe(200)
    expect(bindCookieDomain(res)).toBe('.jeffistores.in')
  })

  it('subdomain (business.jeffistores.in): bind cookie carries Domain=.jeffistores.in', async () => {
    const res = await POST(rtRequest('business.jeffistores.in'))
    expect(bindCookieDomain(res)).toBe('.jeffistores.in')
  })

  it('subdomain (admin.jeffistores.in): bind cookie carries Domain=.jeffistores.in', async () => {
    const res = await POST(rtRequest('admin.jeffistores.in'))
    expect(bindCookieDomain(res)).toBe('.jeffistores.in')
  })

  it('custom tenant domain: no Domain attribute (stays host-pinned)', async () => {
    vi.mocked(loadSessionKey).mockResolvedValue({ jwk: {} as any, host: 'tenant-shop.com', createdAt: Date.now() })
    const res = await POST(rtRequest('tenant-shop.com'))
    expect(bindCookieDomain(res)).toBeNull()
  })

  it('non-production: no shared cookie domain, so no Domain attribute', async () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'development'
    const res = await POST(rtRequest('jeffistores.in'))
    expect(bindCookieDomain(res)).toBeNull()
  })
})
