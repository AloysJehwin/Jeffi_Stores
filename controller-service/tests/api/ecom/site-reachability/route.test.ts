import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockTenants, mockQuery, mockFetch } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockTenants: vi.fn(),
  mockQuery: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/tenant-registry', () => ({ getOwnerTenants: mockTenants, controlPlanePool: () => ({ query: mockQuery }) }))

import { GET } from '@controller/app/api/(ecom)/ecom/site-reachability/route'

const req = (url?: string) =>
  new NextRequest(`https://ecom.jeffistores.in/api/ecom/site-reachability${url === undefined ? '' : `?url=${encodeURIComponent(url)}`}`)

describe('GET /api/ecom/site-reachability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockOwner.mockResolvedValue({ id: 'o-1' })
    mockTenants.mockResolvedValue([{ id: 't-1', slug: 'acme' }])
    mockQuery.mockResolvedValue({ rows: [] })
    mockFetch.mockResolvedValue({ status: 200 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('401s without a session', async () => {
    mockOwner.mockResolvedValue(null)
    expect((await GET(req('https://acme.jeffistores.in'))).status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('400s a missing, malformed or non-https url', async () => {
    expect((await GET(req())).status).toBe(400)
    expect((await GET(req('not a url'))).status).toBe(400)
    expect((await GET(req('http://acme.jeffistores.in'))).status).toBe(400)
  })

  it('403s a host that is not the owner’s and never probes it', async () => {
    const res = await GET(req('https://evil.test/'))
    expect(res.status).toBe(403)
    expect(mockQuery.mock.calls[0][1]).toEqual(['evil.test', ['t-1']])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('probes the store host and reports status and latency', async () => {
    const res = await GET(req('https://acme.jeffistores.in/'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ url: 'https://acme.jeffistores.in/', ok: true, status: 200 })
    expect(typeof body.latencyMs).toBe('number')
    expect(mockFetch.mock.calls[0][0]).toBe('https://acme.jeffistores.in/')
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('allows a verified custom domain', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] })
    expect((await GET(req('https://shop.acme.test/'))).status).toBe(200)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('reports an unreachable site as ok:false with the error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await GET(req('https://acme.jeffistores.in/'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, status: 0, error: 'ECONNREFUSED' })
  })
})
