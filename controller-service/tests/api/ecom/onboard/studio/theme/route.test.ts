import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ owner: vi.fn(), avail: vi.fn(), open: vi.fn(), apply: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', async () => (await import('../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn() }))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: vi.fn() }))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'available' }) }))
vi.mock('@/lib/site/themes/pages', () => ({ themeAvailability: m.avail }))
vi.mock('@controller/lib/site-studio/themes', () => ({ openThemeStudio: m.open, applyTheme: m.apply }))

import { GET, POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/theme/route'

const url = 'http://ecom.localhost/api/ecom/onboard/studio/theme'
const post = (body: unknown, qs = '') => POST(new NextRequest(url + qs, { method: 'POST', body: JSON.stringify(body) }))
const SESSION = { id: 'sess-1', product: 'store' }

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.avail.mockReturnValue({ minimalist: 3 })
  m.open.mockResolvedValue({ ok: true, session: SESSION })
  m.apply.mockResolvedValue({ ok: true, session: SESSION })
})

describe('GET /api/ecom/onboard/studio/theme', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await GET(new NextRequest(url))).status).toBe(401)
  })

  it('lists the ready styles for the studio’s product', async () => {
    const res = await GET(new NextRequest(url + '?product=showcase'))
    expect(await res.json()).toEqual({ available: { minimalist: 3 } })
    expect(m.avail).toHaveBeenCalledWith('showcase')
  })
})

describe('POST /api/ecom/onboard/studio/theme', () => {
  it('401s without an owner session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await post({ action: 'open' })).status).toBe(401)
    expect(m.open).not.toHaveBeenCalled()
  })

  it('opens the studio', async () => {
    const res = await post({ action: 'open' })
    expect(res.status).toBe(200)
    expect(m.open).toHaveBeenCalledWith('o-1', 'store', null)
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('passes a failed open through with its status and code', async () => {
    m.open.mockResolvedValue({ ok: false, error: 'No site', status: 409, code: 'no_site' })
    const res = await post({ action: 'open' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'No site', code: 'no_site' })
  })

  it('400s for an unknown action', async () => {
    expect((await post({ action: 'nope' })).status).toBe(400)
  })

  it('applies a theme, replacing only when asked; a refusal keeps its code', async () => {
    expect((await post({ action: 'apply', theme: 'minimalist.ocean', replace: true })).status).toBe(200)
    expect(m.apply).toHaveBeenCalledWith(SESSION, 'minimalist.ocean', { replace: true })
    m.apply.mockResolvedValue({ ok: false, error: 'Site exists', status: 409, code: 'has_site' })
    const res = await post({ action: 'apply', theme: 'minimalist.ocean' })
    expect(m.apply).toHaveBeenLastCalledWith(SESSION, 'minimalist.ocean', { replace: false })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Site exists', code: 'has_site' })
  })
})
