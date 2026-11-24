import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ owner: vi.fn(), session: vi.fn(), aiUp: vi.fn(), context: vi.fn(), sync: vi.fn(), showcaseState: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', async () => (await import('./http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: m.aiUp }))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: m.session }))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'available' }) }))
vi.mock('@controller/lib/site-studio/context', () => ({ studioStoreContext: m.context, syncStudioStore: m.sync }))
vi.mock('@controller/lib/showcase-builder/studio', () => ({ showcaseStudioState: m.showcaseState }))

import { GET } from '@controller/app/api/(ecom)/ecom/onboard/studio/route'

const get = (qs = '') => GET(new NextRequest(`http://ecom.localhost/api/ecom/onboard/studio${qs}`))
const SESSION = { id: 'sess-1', product: 'store', owner_id: 'o-1', pages: {}, catalog: null }

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.session.mockResolvedValue(SESSION)
  m.aiUp.mockResolvedValue(true)
  m.context.mockResolvedValue({ name: 'Lens' })
  m.sync.mockImplementation(async (s: unknown) => s)
})

describe('GET /api/ecom/onboard/studio', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })

  it('returns the synced store session with the store details and AI availability', async () => {
    const res = await get()
    const body = await res.json()
    expect(body).toMatchObject({ session: { id: 'sess-1', hasCatalog: false }, store: { name: 'Lens' }, ai: { available: true } })
    expect(m.sync).toHaveBeenCalledWith(SESSION, { name: 'Lens' })
    expect(m.aiUp).toHaveBeenCalledWith('platform', { fresh: false })
  })

  it('checks AI again with ?fresh=1 and falls back to the session when the sync fails', async () => {
    m.sync.mockRejectedValue(new Error('boom'))
    const res = await get('?fresh=1')
    expect((await res.json()).session.id).toBe('sess-1')
    expect(m.aiUp).toHaveBeenCalledWith('platform', { fresh: true })
  })

  it('has no session before the studio is started', async () => {
    m.session.mockResolvedValue(null)
    expect((await (await get()).json()).session).toBeNull()
    expect(m.sync).not.toHaveBeenCalled()
  })

  it('hands a Showcase studio to its own state', async () => {
    m.showcaseState.mockResolvedValue({ session: { id: 'sc-1' } })
    const res = await get('?product=showcase&fresh=1')
    expect(await res.json()).toEqual({ session: { id: 'sc-1' } })
    expect(m.showcaseState).toHaveBeenCalledWith('o-1', null, { fresh: true })
    expect(m.context).not.toHaveBeenCalled()
  })
})
