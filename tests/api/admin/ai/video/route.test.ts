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
  return { AiWalletError, AiMediaError, generateVideo: vi.fn(), videoJob: vi.fn() }
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
vi.mock('@/lib/ai/media', () => ({ generateVideo: h.generateVideo, videoJob: h.videoJob, AiMediaError: h.AiMediaError }))

import { POST } from '@/app/api/(admin)/admin/ai/video/route'
import { GET } from '@/app/api/(admin)/admin/ai/video/[jobId]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'

const ADMIN = { adminId: 'a1', email: 'a@b.c', role: 'staff', scopes: ['social:write', 'catalog_enrichment:write'] }
const USAGE = '11111111-1111-4111-8111-111111111111'
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/ai/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const poll = (jobId: string, usageId?: string) =>
  GET(new NextRequest(`http://localhost/api/admin/ai/video/${jobId}${usageId ? `?usageId=${usageId}` : ''}`), { params: Promise.resolve({ jobId }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  h.generateVideo.mockResolvedValue({ jobId: 'job-1', usageId: USAGE, estimatedPriceInr: 12, provider: 'google', model: 'veo-3' })
})

describe('POST /api/admin/ai/video', () => {
  it('starts a job and returns jobId', async () => {
    const res = await POST(post({ feature: 'social_video', prompt: 'a bolt spinning', durationSec: 6, aspect: '16:9' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ jobId: 'job-1', usageId: USAGE, estimatedPriceInr: 12 })
    expect(h.generateVideo).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 6, aspect: '16:9', actor: 'a@b.c' }))
  })

  it('accepts only 4, 6 or 8 seconds and 9:16 or 16:9', async () => {
    expect((await POST(post({ feature: 'social_video', prompt: 'a bolt spinning', durationSec: 5 }))).status).toBe(400)
    expect((await POST(post({ feature: 'social_video', prompt: 'a bolt spinning', aspect: '1:1' }))).status).toBe(400)
    expect((await POST(post({ feature: 'social_image', prompt: 'a bolt spinning' }))).status).toBe(400)
  })

  it('403s without social:write', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ ...ADMIN, scopes: ['catalog_enrichment:write'] } as any)
    expect((await POST(post({ feature: 'social_video', prompt: 'a bolt spinning' }))).status).toBe(403)
  })

  it('403s when the plan does not include AI', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, plan: 'basic', upgradeRequired: 'pro' })
    expect((await POST(post({ feature: 'social_video', prompt: 'a bolt spinning' }))).status).toBe(403)
  })

  it('maps AiWalletError to 402', async () => {
    h.generateVideo.mockRejectedValue(new h.AiWalletError('Insufficient wallet balance for AI call', 0, 12))
    const res = await POST(post({ feature: 'social_video', prompt: 'a bolt spinning' }))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ balanceInr: 0, neededInr: 12, topUpUrl: '/admin/wallet' })
  })
})

describe('GET /api/admin/ai/video/[jobId]', () => {
  it('polls the job with the usage id', async () => {
    h.videoJob.mockResolvedValue({ status: 'done', videoUrl: 'https://cdn/ai/video/job-1.mp4', durationSec: 6, priceInr: 11 })
    const res = await poll('job-1', USAGE)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'done', videoUrl: 'https://cdn/ai/video/job-1.mp4' })
    expect(h.videoJob).toHaveBeenCalledWith('job-1', USAGE)
  })

  it('400s a malformed job id or usage id', async () => {
    expect((await poll('../etc')).status).toBe(400)
    expect((await poll('job-1', 'nope')).status).toBe(400)
  })

  it('403s without social:write', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ ...ADMIN, scopes: ['catalog_enrichment:write'] } as any)
    expect((await poll('job-1')).status).toBe(403)
    expect(h.videoJob).not.toHaveBeenCalled()
  })

  it('keeps the AiMediaError status', async () => {
    h.videoJob.mockRejectedValue(new h.AiMediaError('AI gateway error 502', 502))
    expect((await poll('job-1')).status).toBe(502)
  })
})
