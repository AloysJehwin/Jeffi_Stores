import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  owner: vi.fn(),
  session: vi.fn(),
  start: vi.fn(),
  update: vi.fn(),
  aiUp: vi.fn(),
  ownedShowcase: vi.fn(),
  startShowcase: vi.fn(),
}))

vi.mock('@controller/lib/site-studio/http', async () => (await import('../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: m.aiUp }))
vi.mock('@/lib/site/studio', () => ({ cleanAnswers: (a: Record<string, unknown>) => a }))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  getStudioSession: m.session,
  startStudioSession: m.start,
  updateStudioSession: m.update,
  buildRunning: (s: { status: string }) => s.status === 'building',
}))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'available' }) }))
vi.mock('@controller/lib/site-studio/context', () => ({
  studioStoreContext: async () => ({ categories: ['shoes', 'bags'] }),
  studioStoreAnswers: () => ({ name: 'Lens' }),
}))
vi.mock('@controller/lib/showcase-builder/site', () => ({ ownedShowcase: m.ownedShowcase }))
vi.mock('@controller/lib/showcase-builder/studio', () => ({ startShowcaseStudio: m.startShowcase }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/start/route'

const SITE_ID = '11111111-1111-4111-8111-111111111111'
const post = (body: unknown = {}, qs = '') => POST(new NextRequest(`http://ecom.localhost/api/ecom/onboard/studio/start${qs}`, { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.aiUp.mockResolvedValue(true)
  m.session.mockResolvedValue(null)
  m.start.mockResolvedValue({ id: 'sess-1', product: 'store', answers: {} })
  m.update.mockImplementation(async (_id: string, patch: object) => ({ id: 'sess-1', product: 'store', ...patch }))
})

describe('POST /api/ecom/onboard/studio/start', () => {
  it('401s without an owner session and 503s while the AI is down', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    m.owner.mockResolvedValue({ id: 'o-1' })
    m.aiUp.mockResolvedValue(false)
    expect((await post()).status).toBe(503)
    expect(m.start).not.toHaveBeenCalled()
  })

  it('opens the store studio prefilled with what the wizard knows', async () => {
    const res = await post({ prefill: { tagline: 'Hi' } })
    expect(res.status).toBe(200)
    expect(m.start).toHaveBeenCalledWith('o-1', false)
    expect(m.update).toHaveBeenCalledWith('sess-1', { answers: { sell: 'shoes, bags', name: 'Lens', tagline: 'Hi' } })
  })

  it('keeps answers a session already has', async () => {
    m.start.mockResolvedValue({ id: 'sess-1', product: 'store', answers: { sell: 'x' } })
    await post()
    expect(m.update).not.toHaveBeenCalled()
  })

  it('refuses a restart while a build runs', async () => {
    m.session.mockResolvedValue({ id: 'sess-1', status: 'building' })
    const res = await post({ restart: true })
    expect(res.status).toBe(409)
    expect(m.start).not.toHaveBeenCalled()
  })

  it('starts a Showcase studio from its saved site, or 409s without one', async () => {
    m.ownedShowcase.mockResolvedValue(null)
    expect((await post({}, `?product=showcase&site=${SITE_ID}`)).status).toBe(409)
    m.ownedShowcase.mockResolvedValue({ id: SITE_ID })
    m.startShowcase.mockResolvedValue({ id: 'sess-2', product: 'showcase' })
    const res = await post({ restart: true }, `?product=showcase&site=${SITE_ID}`)
    expect(res.status).toBe(200)
    expect(m.ownedShowcase).toHaveBeenCalledWith('o-1', SITE_ID)
    expect(m.startShowcase).toHaveBeenCalledWith('o-1', { id: SITE_ID }, true)
  })
})
