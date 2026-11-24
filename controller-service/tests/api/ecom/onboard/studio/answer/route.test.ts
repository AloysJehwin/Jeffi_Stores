import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The studio brief: save answers, "Help me answer", and finish into a brief + plan. No AI runs.

const m = vi.hoisted(() => ({
  owner: vi.fn(),
  session: vi.fn(),
  update: vi.fn(),
  spend: vi.fn(),
  refund: vi.fn(),
  aiUp: vi.fn(),
  suggest: vi.fn(),
  brief: vi.fn(),
  plan: vi.fn(),
  locked: vi.fn(),
}))

vi.mock('@controller/lib/site-studio/http', async () => (await import('../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: m.aiUp }))
vi.mock('@/lib/site/studio', () => ({
  cleanAnswers: (a: Record<string, unknown>) => a,
  brief: m.brief,
  plan: m.plan,
  planShowcase: vi.fn(),
  showcaseBrief: vi.fn(),
  suggestAnswer: m.suggest,
  suggestShowcaseAnswer: vi.fn(),
}))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: m.session, updateStudioSession: m.update, spendTweaks: m.spend, refundTweaks: m.refund }))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'available' }), COST: { help: 1, directions: 2 }, HELP_PER_DAY: 30 }))
vi.mock('@controller/lib/site-studio/funded', () => ({ funded: (_id: string, _b: unknown, fn: () => unknown) => fn(), preBuildBudget: () => 25 }))
vi.mock('@controller/lib/site-studio/rules', () => ({ designLocked: m.locked }))
vi.mock('@controller/lib/site-studio/context', () => ({ studioStoreContext: async () => ({ audiences: ['retail'] }) }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/answer/route'

const SESSION = { id: 'sess-1', product: 'store', answers: { sell: 'shoes' }, brief: null, tweaks_today: 0 }
const post = (body: unknown) => POST(new NextRequest('http://ecom.localhost/api/ecom/onboard/studio/answer', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue(SESSION)
  m.update.mockImplementation(async (_id: string, patch: object) => ({ ...SESSION, ...patch }))
  m.spend.mockResolvedValue(true)
  m.aiUp.mockResolvedValue(true)
  m.locked.mockReturnValue(null)
  m.brief.mockResolvedValue({ name: 'b' })
  m.plan.mockResolvedValue({ pages: [] })
  m.suggest.mockResolvedValue('Running shoes')
})

describe('POST /api/ecom/onboard/studio/answer', () => {
  it('401s without an owner session and 404s without a studio', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post({})).status).toBe(401)
    m.owner.mockResolvedValue({ id: 'o-1' })
    m.session.mockResolvedValue(null)
    expect((await post({})).status).toBe(404)
  })

  it('rejects an unknown help question, a bad body and a locked design', async () => {
    expect((await post({ help: 'colour' })).status).toBe(400)
    const bad = await POST(new NextRequest('http://ecom.localhost/x', { method: 'POST', body: 'nope' }))
    expect(bad.status).toBe(400)
    m.locked.mockReturnValue('Design is locked')
    const r = await post({ finish: true })
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'Design is locked' })
  })

  it('saves the merged answers', async () => {
    const res = await post({ answers: { audience: 'runners' } })
    expect(res.status).toBe(200)
    expect(m.update).toHaveBeenCalledWith('sess-1', { answers: { sell: 'shoes', audience: 'runners' } })
  })

  it('suggests an answer and spends one help', async () => {
    const res = await post({ help: 'sell' })
    expect(await res.json()).toMatchObject({ suggestion: 'Running shoes' })
    expect(m.spend).toHaveBeenCalledWith('sess-1', 1, 30)
  })

  it('429s when the day’s help is used, and refunds + 502s when the AI fails', async () => {
    m.spend.mockResolvedValue(false)
    expect((await post({ help: 'sell' })).status).toBe(429)
    m.spend.mockResolvedValue(true)
    m.suggest.mockRejectedValue(new Error('boom'))
    expect((await post({ help: 'sell' })).status).toBe(502)
    expect(m.refund).toHaveBeenCalledWith('sess-1', 1)
  })

  it('finishes into a brief and plan; 400s on a short answer; 503s when AI is down', async () => {
    const res = await post({ finish: true })
    expect(res.status).toBe(200)
    expect(m.plan).toHaveBeenCalledWith({ name: 'b' }, ['retail'])
    expect(m.update).toHaveBeenLastCalledWith('sess-1', expect.objectContaining({ brief: { name: 'b' }, plan: { pages: [] }, status: 'plan' }))
    m.session.mockResolvedValue({ ...SESSION, answers: { sell: 'x' } })
    expect((await post({ finish: true })).status).toBe(400)
    m.aiUp.mockResolvedValue(false)
    expect((await post({ finish: true })).status).toBe(503)
  })

  it('502s when the brief fails', async () => {
    m.brief.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post({ finish: true })).status).toBe(502)
  })
})
