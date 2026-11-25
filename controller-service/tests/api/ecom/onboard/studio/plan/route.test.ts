import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ owner: vi.fn(), session: vi.fn(), update: vi.fn(), locked: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', async () => (await import('../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn() }))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: m.session, updateStudioSession: m.update }))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'available' }) }))
vi.mock('@controller/lib/site-studio/rules', () => ({ designLocked: m.locked }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/plan/route'

const PLAN = {
  pages: [
    { key: 'store:home', enabled: true },
    { key: 'store:about', optional: true, enabled: true },
  ],
}
const post = (body: unknown) => POST(new NextRequest('http://ecom.localhost/api/ecom/onboard/studio/plan', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue({ id: 'sess-1', product: 'store', plan: PLAN })
  m.update.mockImplementation(async (_id: string, patch: object) => ({ id: 'sess-1', ...patch }))
  m.locked.mockReturnValue(null)
})

describe('POST /api/ecom/onboard/studio/plan', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post({ enabled: {} })).status).toBe(401)
  })

  it('409s without a plan, and when the design is locked', async () => {
    m.session.mockResolvedValue({ id: 'sess-1', product: 'store', plan: null })
    expect((await post({ enabled: {} })).status).toBe(409)
    m.session.mockResolvedValue({ id: 'sess-1', product: 'store', plan: PLAN })
    m.locked.mockReturnValue('Locked')
    expect((await post({ enabled: {} })).status).toBe(409)
    expect(m.update).not.toHaveBeenCalled()
  })

  it('400s when there is nothing to change', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Nothing to change' })
  })

  it('turns an optional page off but never a required one', async () => {
    const res = await post({ enabled: { 'store:about': false, 'store:home': false } })
    expect(res.status).toBe(200)
    expect(m.update).toHaveBeenCalledWith('sess-1', {
      plan: { pages: [{ key: 'store:home', enabled: true }, { key: 'store:about', optional: true, enabled: false }] },
    })
  })
})
