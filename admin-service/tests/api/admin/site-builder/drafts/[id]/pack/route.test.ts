import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/site/apply-pack', () => ({ applySitePack: vi.fn() }))
vi.mock('@/lib/site/store', () => {
  class SiteDocInvalid extends Error {
    constructor(readonly issues: { blockId?: string; message: string }[], message = 'Invalid') {
      super(message)
    }
  }
  return { SiteDocInvalid }
})
vi.mock('@/lib/site/themes/apply', () => ({ applyThemeToDraft: vi.fn() }))
vi.mock('@/lib/site/themes/catalog', () => ({ THEME_PACK_PREFIX: 'theme:' }))

import { POST } from '@admin/app/api/(admin)/admin/site-builder/drafts/[id]/pack/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { applySitePack } from '@/lib/site/apply-pack'
import { SiteDocInvalid } from '@/lib/site/store'
import { applyThemeToDraft } from '@/lib/site/themes/apply'

const ctx = { params: Promise.resolve({ id: 'd1' }) }
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/drafts/d1/pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
})

describe('POST /api/admin/site-builder/drafts/[id]/pack', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await POST(req({ packId: 'p' }), ctx)).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(applySitePack).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{}], [{ packId: 'x'.repeat(81) }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(req(body), ctx)).status).toBe(400)
    expect(applySitePack).not.toHaveBeenCalled()
  })

  it('applies a site pack to the draft as the admin', async () => {
    vi.mocked(applySitePack).mockResolvedValue({ pages: 5, audience: 'store' } as any)
    const res = await POST(req({ packId: 'starter' }), ctx)
    expect(await res.json()).toEqual({ pages: 5, audience: 'store' })
    expect(applySitePack).toHaveBeenCalledWith('d1', 'starter', 'a1')
    expect(applyThemeToDraft).not.toHaveBeenCalled()
  })

  it('applies a ready-made theme from a theme: pack id', async () => {
    vi.mocked(applyThemeToDraft).mockResolvedValue({ pages: 7 } as any)
    const res = await POST(req({ packId: 'theme:bold.sunset' }), ctx)
    expect(await res.json()).toEqual({ pages: 7, audience: 'store' })
    expect(applyThemeToDraft).toHaveBeenCalledWith('d1', 'bold.sunset', 'a1')
    expect(applySitePack).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown pack or theme', async () => {
    vi.mocked(applySitePack).mockResolvedValue(null as any)
    expect((await POST(req({ packId: 'nope' }), ctx)).status).toBe(404)
    vi.mocked(applyThemeToDraft).mockResolvedValue(null as any)
    expect((await POST(req({ packId: 'theme:nope' }), ctx)).status).toBe(404)
  })

  it('returns 400 with the issues when the pack makes an invalid document', async () => {
    vi.mocked(applySitePack).mockRejectedValue(new SiteDocInvalid([{ message: 'bad block' }]))
    const res = await POST(req({ packId: 'starter' }), ctx)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid', issues: [{ message: 'bad block' }] })
  })

  it('returns 404 when the draft is gone and rethrows other failures', async () => {
    vi.mocked(applySitePack).mockRejectedValueOnce(new Error('Draft not found'))
    expect((await POST(req({ packId: 'starter' }), ctx)).status).toBe(404)
    vi.mocked(applySitePack).mockRejectedValueOnce(new Error('db'))
    await expect(POST(req({ packId: 'starter' }), ctx)).rejects.toThrow('db')
  })
})
