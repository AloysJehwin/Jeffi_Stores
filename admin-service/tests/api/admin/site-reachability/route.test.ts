import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ storeBaseUrlAsync: vi.fn(async () => 'https://shop.jeffistores.in') }))

import { GET } from '@admin/app/api/(admin)/admin/site-reachability/route'
import { requireAdminScope } from '@/lib/auth/jwt'

const call = (qs = '') => GET(new NextRequest(`http://localhost/x${qs}`))
const fetchMock = vi.fn()

describe('GET /api/admin/site-reachability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({ status: 200 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('returns the auth failure without probing (needs dashboard:read)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'dashboard:read')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['not a url', '?url=nope'],
    ['plain http', '?url=http://shop.jeffistores.in'],
    ['a foreign host', '?url=https://evil.example.com'],
    ['a lookalike host', '?url=https://notjeffistores.in'],
  ])('rejects %s with 400 and never fetches', async (_n, qs) => {
    expect((await call(qs)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("probes the store's own URL by default without following redirects", async () => {
    const body = await (await call()).json()
    expect(body).toMatchObject({ url: 'https://shop.jeffistores.in', ok: true, status: 200 })
    expect(typeof body.latencyMs).toBe('number')
    expect(fetchMock.mock.calls[0][0]).toBe('https://shop.jeffistores.in')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('probes an allowed platform subdomain', async () => {
    const body = await (await call('?url=https://acme.jeffistores.in/path')).json()
    expect(body.url).toBe('https://acme.jeffistores.in/path')
  })

  it('reports an unreachable site as ok=false with status 0', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, status: 0, error: 'ECONNREFUSED' })
  })
})
