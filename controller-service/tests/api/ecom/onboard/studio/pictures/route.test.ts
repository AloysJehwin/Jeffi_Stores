import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ owner: vi.fn(), session: vi.fn(), claim: vi.fn(), run: vi.fn(), reload: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', async () => (await import('../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn() }))
vi.mock('@controller/lib/site-studio/sessions', () => ({
  getStudioSession: m.session,
  buildRunning: (s: { status: string }) => s.status === 'building',
  claimPictures: m.claim,
}))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'used' }) }))
vi.mock('@controller/lib/site-studio/build', () => ({ reload: m.reload, runPictures: m.run }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/pictures/route'

const BUILT = { id: 'sess-1', product: 'store', status: 'ready', pages: { 'store:home': { order: [] } }, progress: null }
const post = () => POST(new NextRequest('http://ecom.localhost/api/ecom/onboard/studio/pictures', { method: 'POST' }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue(BUILT)
  m.claim.mockResolvedValue(true)
  m.run.mockResolvedValue({ made: 3 })
  m.reload.mockResolvedValue(BUILT)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/ecom/onboard/studio/pictures', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(m.run).not.toHaveBeenCalled()
  })

  it('409s before a site is built, and while a build or the photos are running', async () => {
    m.session.mockResolvedValue({ ...BUILT, pages: {} })
    expect((await post()).status).toBe(409)
    m.session.mockResolvedValue({ ...BUILT, status: 'building' })
    const running = await post()
    expect(running.status).toBe(409)
    expect(await running.json()).toMatchObject({ code: 'running' })
    m.session.mockResolvedValue({ ...BUILT, progress: { step: 'photos' } })
    m.claim.mockResolvedValue(false)
    expect((await post()).status).toBe(409)
    expect(m.run).not.toHaveBeenCalled()
  })

  it('makes the photos again and returns how many', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pictures: 3 })
    expect(m.run).toHaveBeenCalledWith(BUILT)
    expect(m.reload).toHaveBeenCalledWith('sess-1')
  })

  it('503s when the image service made none', async () => {
    m.run.mockResolvedValue({ made: 0, error: 'down' })
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'pictures_unavailable' })
  })
})
