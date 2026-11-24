import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/ai-scope', () => ({ aiDenial: vi.fn(), AI_ADMIN_SCOPE: 'ai' }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/ai/media', () => ({ generateImage: vi.fn() }))
vi.mock('@/lib/ai/media-route', () => ({
  aiMediaErrorResponse: vi.fn(() => NextResponse.json({ error: 'ai failed' }, { status: 402 })),
}))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({ actorOf: vi.fn(() => 'actor'), lockedByOther: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/product-offers/[id]/generate-image/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { generateImage } from '@/lib/ai/media'
import { query, queryOne } from '@/lib/shared/db'
import { lockedByOther } from '@/lib/admin/draft-locks'

const admin = { adminId: 'a1', role: 'admin', scopes: [], email: 'a@x.in' }
const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'of1' }),
  })

describe('POST /api/admin/product-offers/[id]/generate-image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue(admin as never)
    vi.mocked(aiDenial).mockReturnValue(null as never)
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as never)
    vi.mocked(queryOne).mockResolvedValue({ id: 'of1' })
    vi.mocked(lockedByOther).mockResolvedValue(null as never)
  })

  it('returns the auth response when the scope is missing', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await call({ prompt: 'a scene' })).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'coupons:write')
  })

  it('returns 403 when the AI scope or plan denies', async () => {
    vi.mocked(aiDenial).mockReturnValue('No AI scope' as never)
    expect((await call({ prompt: 'a scene' })).status).toBe(403)
    vi.mocked(aiDenial).mockReturnValue(null as never)
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false } as never)
    expect((await call({ prompt: 'a scene' })).status).toBe(403)
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown offer and relays an editing lock', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await call({ prompt: 'a scene' })).status).toBe(404)
    vi.mocked(queryOne).mockResolvedValue({ id: 'of1' })
    vi.mocked(lockedByOther).mockResolvedValue(NextResponse.json({ error: 'locked' }, { status: 423 }) as never)
    expect((await call({ prompt: 'a scene' })).status).toBe(423)
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('returns 400 for a too-short prompt', async () => {
    expect((await call({ prompt: 'ab' })).status).toBe(400)
    expect((await call({})).status).toBe(400)
  })

  it('generates a banner and stores it on the image_url column', async () => {
    vi.mocked(generateImage).mockResolvedValue({ images: [{ url: 'https://cdn/x.png', blurhash: 'bh' }] } as never)
    const res = await call({ prompt: ' red shoes ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://cdn/x.png', field: 'image_url', blurhash: 'bh' })
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ feature: 'offer_image', width: 1536, height: 640, ref: 'of1', actor: 'a@x.in' }))
    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(sql).toMatch(/SET image_url = \$1, blurhash = \$2/)
    expect(params).toEqual(['https://cdn/x.png', 'bh', 'of1'])
  })

  it('uses the portrait size and card columns for field=image_url_card', async () => {
    vi.mocked(generateImage).mockResolvedValue({ images: [{ url: 'u' }] } as never)
    await call({ prompt: 'red shoes', field: 'image_url_card' })
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ width: 1024, height: 1280 }))
    expect(vi.mocked(query).mock.calls[0][0]).toMatch(/image_url_card = \$1, blurhash_card = \$2/)
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['u', null, 'of1'])
  })

  it('returns 502 when the model returns no image', async () => {
    vi.mocked(generateImage).mockResolvedValue({ images: [] } as never)
    expect((await call({ prompt: 'red shoes' })).status).toBe(502)
    expect(query).not.toHaveBeenCalled()
  })

  it('maps a generation failure through the AI error responder', async () => {
    vi.mocked(generateImage).mockRejectedValue(new Error('credits'))
    expect((await call({ prompt: 'red shoes' })).status).toBe(402)
    expect(query).not.toHaveBeenCalled()
  })
})
