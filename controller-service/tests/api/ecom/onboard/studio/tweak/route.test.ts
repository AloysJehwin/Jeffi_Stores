import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => {
  class PaidGenerationError extends Error {
    status = 402
    body = () => ({ code: 'wallet_low' })
  }
  return {
    PaidGenerationError,
    owner: vi.fn(),
    session: vi.fn(),
    aiUp: vi.fn(),
    claim: vi.fn(),
    run: vi.fn(),
    tweakSection: vi.fn(),
    savePage: vi.fn(),
    reload: vi.fn(),
  }
})

vi.mock('@controller/lib/site-studio/http', async () => (await import('../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: m.aiUp }))
vi.mock('@/lib/site/studio', () => ({ tweakSection: m.tweakSection }))
vi.mock('@/lib/ai/paid-generation', () => ({ PaidGenerationError: m.PaidGenerationError }))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  getStudioSession: m.session,
  buildRunning: (s: { status: string }) => s.status === 'building',
  saveStudioPage: m.savePage,
}))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'used' }), BUDGET_INR: { small: 25 }, COST: { tweak: 1 } }))
vi.mock('@controller/lib/site-studio/build', () => ({ reload: m.reload, studioCtx: (s: { id: string }) => ({ ctx: s.id }) }))
vi.mock('@controller/lib/site-studio/corrections', () => ({ claimCorrection: m.claim, runCorrection: m.run }))
vi.mock('@controller/lib/showcase-builder/build', () => ({ WALLET_URL: '/dashboard/wallet' }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/tweak/route'

const BLOCK = { id: 'b1', type: 'hero', props: { label: 'Hero' }, visibility: { hidden: true } }
const DOC = { order: ['b1'], blocks: { b1: BLOCK } }
const SESSION = { id: 'sess-1', product: 'store', status: 'ready', pages: { 'store:home': DOC } }
const GOOD = { page: 'store:home', blockId: 'b1', instruction: 'Make it punchier', priceInr: 20 }
const post = (body: unknown) => POST(new NextRequest('http://ecom.localhost/api/ecom/onboard/studio/tweak', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue(SESSION)
  m.aiUp.mockResolvedValue(true)
  m.claim.mockResolvedValue({ ok: true, correction: { kind: 'free' } })
  m.run.mockImplementation(async (_c: unknown, _b: number, _l: string, fn: () => Promise<void>) => {
    await fn()
    return { chargedInr: 20 }
  })
  m.tweakSection.mockResolvedValue({ type: 'hero', props: { label: 'Hero 2' } })
  m.reload.mockResolvedValue(SESSION)
})

describe('POST /api/ecom/onboard/studio/tweak', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post(GOOD)).status).toBe(401)
  })

  it('404s for a section that is gone, 400s for a missing instruction, 409s mid-build', async () => {
    expect((await post({ ...GOOD, blockId: 'zz' })).status).toBe(404)
    expect((await post({ ...GOOD, instruction: 'a' })).status).toBe(400)
    m.session.mockResolvedValue({ ...SESSION, status: 'building' })
    const res = await post(GOOD)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'running' })
    expect(m.claim).not.toHaveBeenCalled()
  })

  it('503s while the AI is down and passes a refused claim through', async () => {
    m.aiUp.mockResolvedValue(false)
    expect((await post(GOOD)).status).toBe(503)
    m.aiUp.mockResolvedValue(true)
    m.claim.mockResolvedValue({ ok: false, error: 'Price changed', status: 409, extra: { code: 'price_changed' } })
    const res = await post(GOOD)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Price changed', code: 'price_changed' })
  })

  it('rewrites the section in place, keeping its id and visibility, and reports the charge', async () => {
    const res = await post(GOOD)
    expect(await res.json()).toMatchObject({ page: 'store:home', blockId: 'b1', chargedInr: 20 })
    expect(m.claim).toHaveBeenCalledWith(SESSION, 1, 20)
    expect(m.tweakSection).toHaveBeenCalledWith({ ctx: 'sess-1' }, BLOCK, 'Make it punchier', 'store:home')
    expect(m.savePage).toHaveBeenCalledWith('sess-1', 'store:home', {
      ...DOC,
      blocks: { b1: { type: 'hero', props: { label: 'Hero 2' }, id: 'b1', visibility: { hidden: true } } },
    })
  })

  it('402s with a top-up link on a paid-generation error, and 502s on any other failure', async () => {
    m.run.mockRejectedValue(new m.PaidGenerationError('Add money'))
    const low = await post(GOOD)
    expect(low.status).toBe(402)
    expect(await low.json()).toEqual({ error: 'Add money', code: 'wallet_low', topUpUrl: '/dashboard/wallet' })
    m.run.mockRejectedValue(new Error('boom'))
    expect((await post(GOOD)).status).toBe(502)
  })
})
