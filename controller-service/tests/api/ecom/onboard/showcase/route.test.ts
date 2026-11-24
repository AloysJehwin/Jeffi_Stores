import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockStudioOwner, mockOwned, mockSave } = vi.hoisted(() => ({ mockStudioOwner: vi.fn(), mockOwned: vi.fn(), mockSave: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', () => ({
  studioOwner: mockStudioOwner,
  fail: (error: string, status = 400, extra?: Record<string, unknown>) => NextResponse.json({ error, ...extra }, { status }),
  readJson: async (r: NextRequest) => {
    const raw = await r.json().catch(() => null)
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  },
}))
vi.mock('@controller/lib/showcase-builder/site', () => ({
  ownedShowcase: mockOwned,
  saveShowcaseDetails: mockSave,
  siteForClient: (s: unknown) => (s ? { ...(s as object), client: true } : null),
}))

import { GET, POST } from '@controller/app/api/(ecom)/ecom/onboard/showcase/route'

const url = 'https://ecom.jeffistores.in/api/ecom/onboard/showcase'
const post = (body: string) => new NextRequest(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } })

describe('/api/ecom/onboard/showcase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStudioOwner.mockResolvedValue({ id: 'o-1' })
  })

  it('returns the 401 for a signed-out caller on both methods', async () => {
    mockStudioOwner.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
    expect((await POST(post('{}'))).status).toBe(401)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('GET reads the owner-scoped site named by ?site=', async () => {
    mockOwned.mockResolvedValue({ id: 's-1', slug: 'acme' })
    const res = await GET(new NextRequest(`${url}?site=s-1`))
    expect(await res.json()).toEqual({ site: { id: 's-1', slug: 'acme', client: true } })
    expect(mockOwned).toHaveBeenCalledWith('o-1', 's-1')
  })

  it('POST 400s invalid JSON', async () => {
    expect((await POST(post('nope'))).status).toBe(400)
  })

  it('POST saves details and returns the site', async () => {
    mockSave.mockResolvedValue({ ok: true, site: { id: 's-1' } })
    const res = await POST(post(JSON.stringify({ siteId: 's-1', slug: 'acme' })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ site: { id: 's-1', client: true } })
    expect(mockSave).toHaveBeenCalledWith('o-1', 's-1', { siteId: 's-1', slug: 'acme' })
  })

  it('POST maps a field error to 400 and an unowned site to 404', async () => {
    mockSave.mockResolvedValueOnce({ ok: false, error: 'Address taken', field: 'slug' })
    const bad = await POST(post(JSON.stringify({ slug: 'taken' })))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'Address taken', field: 'slug' })
    mockSave.mockResolvedValueOnce({ ok: false, error: 'Not found' })
    expect((await POST(post(JSON.stringify({ siteId: 'x' })))).status).toBe(404)
  })
})
