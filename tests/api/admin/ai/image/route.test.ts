import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  class AiWalletError extends Error {
    status = 402 as const
    constructor(message: string, public balanceInr: number, public neededInr: number) {
      super(message)
    }
  }
  class AiMediaError extends Error {
    constructor(message: string, public status = 502) {
      super(message)
    }
  }
  return { AiWalletError, AiMediaError, generateImage: vi.fn() }
})

vi.mock('@/lib/auth/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const { hasScope } = await import('@/lib/auth/scopes')
  const authenticateAdmin = vi.fn()
  return {
    authenticateAdmin,
    requireAdminScope: vi.fn(async (req: unknown, scope: string) => {
      const a = await authenticateAdmin(req)
      if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (!hasScope(a.role, a.scopes, scope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      return a
    }),
  }
})
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/ai/billing', () => ({ AiWalletError: h.AiWalletError }))
vi.mock('@/lib/ai/media', () => ({ generateImage: h.generateImage, AiMediaError: h.AiMediaError }))

import { POST } from '@controller/app/api/(admin)/admin/ai/image/route'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'

const SOCIAL = { adminId: 'a1', email: 'a@b.c', role: 'staff', scopes: ['social:write', 'catalog_enrichment:write'] }
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/ai/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(SOCIAL as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  h.generateImage.mockResolvedValue({ images: [{ url: 'https://cdn/x.png', width: 1024, height: 1024 }], usageId: 'u1', priceInr: 4, provider: 'razer', model: 'sdxl' })
})

describe('POST /api/admin/ai/image', () => {
  it('generates for a feature the admin can write and returns the images and charge', async () => {
    const res = await POST(req({ feature: 'social_image', prompt: 'a red bolt', n: 2, quality: 'premium' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ images: [{ url: 'https://cdn/x.png' }], priceInr: 4, usageId: 'u1', provider: 'razer' })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
    expect(h.generateImage).toHaveBeenCalledWith(expect.objectContaining({ feature: 'social_image', prompt: 'a red bolt', n: 2, quality: 'premium', actor: 'a@b.c' }))
  })

  it('gates each feature on its own :write scope', async () => {
    const res = await POST(req({ feature: 'product_image', prompt: 'a red bolt' }))
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:write')
    expect(h.generateImage).not.toHaveBeenCalled()
  })

  it('403s when the role lacks the AI scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ ...SOCIAL, scopes: ['social:write'] } as any)
    const res = await POST(req({ feature: 'social_image', prompt: 'a red bolt' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/AI tools/)
  })

  it('403s when the plan does not include AI', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, plan: 'basic', upgradeRequired: 'pro' })
    const res = await POST(req({ feature: 'social_image', prompt: 'a red bolt' }))
    expect(res.status).toBe(403)
    expect(h.generateImage).not.toHaveBeenCalled()
  })

  it('needs products:write to attach the image to a product', async () => {
    const res = await POST(req({ feature: 'social_image', prompt: 'a red bolt', attachToProductId: '11111111-1111-4111-8111-111111111111' }))
    expect(res.status).toBe(403)
  })

  it('400s an invalid body', async () => {
    expect((await POST(req({ feature: 'social_video', prompt: 'a red bolt' }))).status).toBe(400)
    expect((await POST(req({ feature: 'social_image', prompt: 'x' }))).status).toBe(400)
    expect((await POST(req({ feature: 'social_image', prompt: 'a red bolt', n: 9 }))).status).toBe(400)
  })

  it('maps AiWalletError to a 402 with the top-up details', async () => {
    h.generateImage.mockRejectedValue(new h.AiWalletError('Insufficient wallet balance for AI call', 1.5, 2.5))
    const res = await POST(req({ feature: 'social_image', prompt: 'a red bolt' }))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ error: 'Insufficient wallet balance for AI call', balanceInr: 1.5, neededInr: 2.5, topUpUrl: '/admin/wallet' })
  })

  it('keeps the AiMediaError status', async () => {
    h.generateImage.mockRejectedValue(new h.AiMediaError('AI media generation is not set up yet', 503))
    expect((await POST(req({ feature: 'social_image', prompt: 'a red bolt' }))).status).toBe(503)
  })

  it('401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ feature: 'social_image', prompt: 'a red bolt' }))).status).toBe(401)
  })
})
