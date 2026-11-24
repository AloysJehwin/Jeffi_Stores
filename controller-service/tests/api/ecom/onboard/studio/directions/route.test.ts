import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  owner: vi.fn(),
  session: vi.fn(),
  update: vi.fn(),
  spend: vi.fn(),
  refund: vi.fn(),
  aiUp: vi.fn(),
  directions: vi.fn(),
  newDirection: vi.fn(),
  shuffle: vi.fn(),
  locked: vi.fn(),
}))

vi.mock('@controller/lib/site-studio/http', async () => (await import('../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: m.aiUp }))
vi.mock('@/lib/site/studio', () => ({ directions: m.directions, newDirection: m.newDirection, shuffleColours: m.shuffle }))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: m.session, updateStudioSession: m.update, spendTweaks: m.spend, refundTweaks: m.refund }))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'available' }), COST: { help: 1, directions: 2 }, HELP_PER_DAY: 30 }))
vi.mock('@controller/lib/site-studio/funded', () => ({ funded: (_id: string, _b: unknown, fn: () => unknown) => fn(), preBuildBudget: () => 25 }))
vi.mock('@controller/lib/site-studio/rules', () => ({ designLocked: m.locked }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/directions/route'

const BRIEF = { name: 'b' }
const D = [{ id: 'a', theme: { c: 1 } }, { id: 'b', theme: { c: 2 } }]
const base = { id: 'sess-1', product: 'store', brief: BRIEF, plan: { pages: [] }, directions: D, direction: D[0] }
const post = (body: unknown) => POST(new NextRequest('http://ecom.localhost/api/ecom/onboard/studio/directions', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue(base)
  m.update.mockImplementation(async (_id: string, patch: object) => ({ ...base, ...patch }))
  m.spend.mockResolvedValue(true)
  m.aiUp.mockResolvedValue(true)
  m.locked.mockReturnValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/ecom/onboard/studio/directions', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post({ action: 'generate' })).status).toBe(401)
  })

  it('409s without a brief and when the design is locked; 400s for an unknown action', async () => {
    m.session.mockResolvedValue({ ...base, brief: null })
    expect((await post({ action: 'generate' })).status).toBe(409)
    m.session.mockResolvedValue(base)
    m.locked.mockReturnValue('Locked')
    expect((await post({ action: 'generate' })).status).toBe(409)
    m.locked.mockReturnValue(null)
    expect((await post({ action: 'dance' })).status).toBe(400)
  })

  it('503s for generate while the AI is down, before anything is spent', async () => {
    m.aiUp.mockResolvedValue(false)
    expect((await post({ action: 'generate' })).status).toBe(503)
    expect(m.spend).not.toHaveBeenCalled()
  })

  it('generates three directions, charging only a repeat set', async () => {
    m.directions.mockResolvedValue([{ id: 'n' }])
    m.session.mockResolvedValue({ ...base, directions: [] })
    expect((await post({ action: 'generate', ask: ' bold ' })).status).toBe(200)
    expect(m.directions).toHaveBeenCalledWith(BRIEF, 3, { avoid: undefined, ask: 'bold' })
    expect(m.spend).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith('sess-1', { directions: [{ id: 'n' }], direction: null, theme: null, status: 'direction' })

    m.session.mockResolvedValue(base)
    await post({ action: 'generate' })
    expect(m.spend).toHaveBeenCalledWith('sess-1', 2, 30)
  })

  it('refunds and 502s when generating fails; 429s when the day is used', async () => {
    m.directions.mockRejectedValue(new Error('boom'))
    expect((await post({ action: 'generate' })).status).toBe(502)
    expect(m.refund).toHaveBeenCalledWith('sess-1', 2)
    m.spend.mockResolvedValue(false)
    expect((await post({ action: 'generate' })).status).toBe(429)
  })

  it('shuffles one direction’s colours without AI and keeps the chosen theme in step', async () => {
    m.shuffle.mockReturnValue({ id: 'a2', theme: { c: 9 } })
    expect((await post({ action: 'shuffle', index: 0 })).status).toBe(200)
    expect(m.shuffle).toHaveBeenCalledWith(BRIEF, D[0])
    expect(m.update).toHaveBeenCalledWith('sess-1', { directions: [{ id: 'a2', theme: { c: 9 } }, D[1]], direction: { id: 'a2', theme: { c: 9 } }, theme: { c: 9 } })
    expect((await post({ action: 'shuffle', index: 7 })).status).toBe(400)
  })

  it('replaces a direction with a new one, refunding when that fails', async () => {
    m.newDirection.mockResolvedValue({ id: 'z', theme: { c: 5 } })
    expect((await post({ action: 'new', index: 1 })).status).toBe(200)
    expect(m.spend).toHaveBeenCalledWith('sess-1', 1, 30)
    expect(m.update).toHaveBeenCalledWith('sess-1', { directions: [D[0], { id: 'z', theme: { c: 5 } }] })
    m.newDirection.mockRejectedValue(new Error('boom'))
    expect((await post({ action: 'new', index: 1 })).status).toBe(502)
    expect(m.refund).toHaveBeenCalledWith('sess-1', 1)
  })
})
