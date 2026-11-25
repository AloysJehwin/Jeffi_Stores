import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockStudioOwner, mockPublish } = vi.hoisted(() => ({ mockStudioOwner: vi.fn(), mockPublish: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', () => ({
  studioOwner: mockStudioOwner,
  fail: (error: string, status = 400, extra?: Record<string, unknown>) => NextResponse.json({ error, ...extra }, { status }),
  readJson: async (r: NextRequest) => {
    const raw = await r.json().catch(() => null)
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  },
}))
vi.mock('@controller/lib/showcase-builder/publish', () => ({ publishOwnerShowcase: mockPublish }))
vi.mock('@controller/lib/showcase-builder/site', () => ({ siteForClient: (s: object) => ({ ...s, client: true }) }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/showcase/publish/route'

const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/onboard/showcase/publish', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('POST /api/ecom/onboard/showcase/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStudioOwner.mockResolvedValue({ id: 'o-1' })
  })

  it('returns the 401 for a signed-out caller', async () => {
    mockStudioOwner.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await POST(req({ siteId: 's-1' }))).status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('publishes the owner site and returns site, url and first', async () => {
    mockPublish.mockResolvedValue({ ok: true, site: { id: 's-1' }, url: 'https://site-acme.jeffistores.in', first: true })
    const res = await POST(req({ siteId: 's-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ site: { id: 's-1', client: true }, url: 'https://site-acme.jeffistores.in', first: true })
    expect(mockPublish).toHaveBeenCalledWith('o-1', 's-1')
  })

  it('passes the failure status, code and checkout url through', async () => {
    mockPublish.mockResolvedValue({ ok: false, error: 'Payment needed', status: 402, code: 'payment_required', checkoutUrl: 'https://pay.test/c' })
    const res = await POST(req({ siteId: 's-1' }))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ error: 'Payment needed', code: 'payment_required', checkoutUrl: 'https://pay.test/c' })
  })

  it('tolerates a body with no siteId', async () => {
    mockPublish.mockResolvedValue({ ok: false, error: 'Not found', status: 404 })
    const res = await POST(req('x'))
    expect(res.status).toBe(404)
    expect(mockPublish).toHaveBeenCalledWith('o-1', undefined)
  })
})
