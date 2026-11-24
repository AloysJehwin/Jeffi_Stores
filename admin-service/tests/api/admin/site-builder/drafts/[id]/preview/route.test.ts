import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/catalog/homepage-preview-token', () => ({ signHomepagePreviewToken: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ getSiteDraft: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/site-builder/drafts/[id]/preview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { signHomepagePreviewToken } from '@/lib/catalog/homepage-preview-token'
import { getSiteDraft } from '@/lib/site/store'

const ctx = { params: Promise.resolve({ id: 'd1' }) }
const req = (qs = '') => new NextRequest(`http://localhost/api/admin/site-builder/drafts/d1/preview${qs}`)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(getSiteDraft).mockResolvedValue({ id: 'd1' } as any)
  vi.mocked(signHomepagePreviewToken).mockResolvedValue('tok' as any)
})

describe('GET /api/admin/site-builder/drafts/[id]/preview', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await GET(req(), ctx)).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(signHomepagePreviewToken).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing draft and signs nothing', async () => {
    vi.mocked(getSiteDraft).mockResolvedValue(null as any)
    expect((await GET(req(), ctx)).status).toBe(404)
    expect(signHomepagePreviewToken).not.toHaveBeenCalled()
  })

  it('signs a store preview token by default', async () => {
    expect(await (await GET(req(), ctx)).json()).toEqual({ token: 'tok' })
    expect(signHomepagePreviewToken).toHaveBeenCalledWith({ draftId: 'd1', audience: 'store', kind: 'site' })
  })

  it('signs a business preview token for audience=business and falls back to store otherwise', async () => {
    await GET(req('?audience=business'), ctx)
    expect(vi.mocked(signHomepagePreviewToken).mock.calls[0][0]).toMatchObject({ audience: 'business' })
    await GET(req('?audience=other'), ctx)
    expect(vi.mocked(signHomepagePreviewToken).mock.calls[1][0]).toMatchObject({ audience: 'store' })
  })

  it('lets a signing failure propagate', async () => {
    vi.mocked(signHomepagePreviewToken).mockRejectedValue(new Error('no key'))
    await expect(GET(req(), ctx)).rejects.toThrow('no key')
  })
})
