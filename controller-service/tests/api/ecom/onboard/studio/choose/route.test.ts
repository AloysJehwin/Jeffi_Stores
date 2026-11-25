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

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/choose/route'

const DIRS = [{ id: 'a', theme: { c: 1 } }, { id: 'b', theme: { c: 2 } }]
const post = (body: unknown) => POST(new NextRequest('http://ecom.localhost/api/ecom/onboard/studio/choose', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue({ id: 'sess-1', product: 'store', directions: DIRS })
  m.update.mockImplementation(async (_id: string, patch: object) => ({ id: 'sess-1', ...patch }))
  m.locked.mockReturnValue(null)
})

describe('POST /api/ecom/onboard/studio/choose', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post({ index: 0 })).status).toBe(401)
    expect(m.update).not.toHaveBeenCalled()
  })

  it('409s when the design is locked', async () => {
    m.locked.mockReturnValue('Locked')
    const res = await post({ index: 0 })
    expect(res.status).toBe(409)
    expect(m.update).not.toHaveBeenCalled()
  })

  it('400s for a direction that is not there', async () => {
    const res = await post({ index: 5 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No such direction' })
  })

  it('saves the picked direction and its theme', async () => {
    const res = await post({ index: 1 })
    expect(res.status).toBe(200)
    expect(m.update).toHaveBeenCalledWith('sess-1', { direction: DIRS[1], theme: DIRS[1].theme, status: 'direction' })
  })
})
