import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireAdminScope = vi.hoisted(() => vi.fn())
const aiDenial = vi.hoisted(() => vi.fn())
const currentTenantPlanGate = vi.hoisted(() => vi.fn())
const generateImage = vi.hoisted(() => vi.fn())
const aiMediaErrorResponse = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope }))
vi.mock('@/lib/auth/ai-scope', () => ({ aiDenial, AI_ADMIN_SCOPE: 'catalog_enrichment:write' }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate }))
vi.mock('@/lib/ai/media', () => ({ generateImage }))
vi.mock('@/lib/ai/media-route', () => ({ aiMediaErrorResponse }))

import { POST } from '@storefront/app/api/(public)/generate-image/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/generate-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

describe('POST /api/generate-image', () => {
  beforeEach(() => {
    requireAdminScope.mockResolvedValue({ role: 'owner', scopes: [], email: 'admin@x.test' })
    aiDenial.mockReturnValue(null)
    currentTenantPlanGate.mockResolvedValue({ allowed: true })
    generateImage.mockResolvedValue({ images: [{ url: 'https://cdn/x.png' }] })
  })

  it('returns the admin auth denial as is', async () => {
    requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await post({ prompt: 'a cat' })).status).toBe(401)
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('403s when the role lacks the AI scope', async () => {
    aiDenial.mockReturnValue('no AI for you')
    const res = await post({ prompt: 'a cat' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('no AI for you')
  })

  it('403s when the plan excludes AI tools', async () => {
    currentTenantPlanGate.mockResolvedValue({ allowed: false })
    expect((await post({ prompt: 'a cat' })).status).toBe(403)
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('400s on a missing or blank prompt', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ prompt: '   ' })).status).toBe(400)
    expect((await post({ prompt: 5 })).status).toBe(400)
  })

  it('generates, clamping size and mapping the model to a quality hint', async () => {
    const res = await post({ prompt: ' a cat ', width: 9999, height: 10, model: 'pro' })
    expect(await res.json()).toEqual({ urls: ['https://cdn/x.png'] })
    expect(generateImage).toHaveBeenCalledWith({
      feature: 'generate_image',
      prompt: 'a cat',
      width: 1536,
      height: 256,
      n: 1,
      quality: 'premium',
      actor: 'admin@x.test',
    })
  })

  it('defaults to draft quality and 1024px', async () => {
    await post({ prompt: 'x', model: 'unknown' })
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ width: 1024, height: 1024, quality: 'draft' }))
  })

  it('maps a generation failure through the media error response', async () => {
    generateImage.mockRejectedValue(new Error('gateway'))
    aiMediaErrorResponse.mockReturnValue(NextResponse.json({ error: 'Out of credits' }, { status: 402 }))
    const res = await post({ prompt: 'x' })
    expect(res.status).toBe(402)
    expect(aiMediaErrorResponse).toHaveBeenCalledWith(expect.any(Error), 'Generation failed')
  })
})
