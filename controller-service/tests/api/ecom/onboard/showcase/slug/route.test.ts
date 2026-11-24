import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockStudioOwner, mockOwned, mockCheck } = vi.hoisted(() => ({ mockStudioOwner: vi.fn(), mockOwned: vi.fn(), mockCheck: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', () => ({ studioOwner: mockStudioOwner }))
vi.mock('@controller/lib/showcase-builder/site', () => ({ ownedShowcase: mockOwned }))
vi.mock('@/lib/showcase/store', () => ({ checkShowcaseSlug: mockCheck }))
vi.mock('@/lib/showcase/host', () => ({ showcaseHost: (s: string) => `site-${s}.jeffistores.in` }))

import { GET } from '@controller/app/api/(ecom)/ecom/onboard/showcase/slug/route'

const req = (qs: string) => new NextRequest(`https://ecom.jeffistores.in/api/ecom/onboard/showcase/slug${qs}`)

describe('GET /api/ecom/onboard/showcase/slug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStudioOwner.mockResolvedValue({ id: 'o-1' })
    mockOwned.mockResolvedValue(null)
  })

  it('returns the 401 for a signed-out caller', async () => {
    mockStudioOwner.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await GET(req('?slug=acme'))).status).toBe(401)
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it("treats the site's own address as always available, without a store lookup", async () => {
    mockOwned.mockResolvedValue({ id: 's-1', slug: 'acme' })
    const res = await GET(req('?slug=%20ACME%20&site=s-1'))
    expect(await res.json()).toEqual({ ok: true, slug: 'acme', host: 'site-acme.jeffistores.in' })
    expect(mockOwned).toHaveBeenCalledWith('o-1', 's-1')
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('returns the checked slug and host for a free address', async () => {
    mockCheck.mockResolvedValue({ ok: true, slug: 'fresh' })
    const res = await GET(req('?slug=Fresh'))
    expect(await res.json()).toEqual({ ok: true, slug: 'fresh', host: 'site-fresh.jeffistores.in' })
    expect(mockCheck).toHaveBeenCalledWith('fresh')
  })

  it('passes a refusal through unchanged', async () => {
    mockCheck.mockResolvedValue({ ok: false, error: 'That address is taken.' })
    expect(await (await GET(req('?slug=taken'))).json()).toEqual({ ok: false, error: 'That address is taken.' })
  })
})
