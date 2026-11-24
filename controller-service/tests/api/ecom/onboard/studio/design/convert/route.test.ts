import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ owner: vi.fn(), session: vi.fn(), enabled: vi.fn(), convert: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', async () => (await import('../../http-mock')).httpMock(m))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn() }))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: m.session }))
vi.mock('@controller/lib/site-studio/allowance', () => ({ allowanceOf: () => ({ free: 'used' }) }))
vi.mock('@/lib/site/convert', () => ({ convertBlock: m.convert }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: m.enabled }))
vi.mock('@/lib/showcase/types', () => ({ SHOWCASE_PAGE_KEY: 'showcase:home' }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/design/convert/route'

const BLOCK = { id: 'b1', type: 'hero', props: {} }
const post = (body: unknown) => POST(new NextRequest('http://ecom.localhost/api/ecom/onboard/studio/design/convert?product=showcase', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.enabled.mockResolvedValue(true)
  m.session.mockResolvedValue({ id: 'sess-1', product: 'showcase', pages: { 'showcase:home': { order: ['b1'], blocks: { b1: BLOCK } } } })
})

describe('POST /api/ecom/onboard/studio/design/convert', () => {
  it('404s while the visual editor is off, and 401s without an owner session', async () => {
    m.enabled.mockResolvedValue(false)
    expect((await post({ blockId: 'b1' })).status).toBe(404)
    m.enabled.mockResolvedValue(true)
    m.owner.mockResolvedValue(null)
    expect((await post({ blockId: 'b1' })).status).toBe(401)
  })

  it('404s for a section that is not saved yet', async () => {
    expect((await post({ blockId: 'nope' })).status).toBe(404)
    expect(m.convert).not.toHaveBeenCalled()
  })

  it('returns the converted block unsaved', async () => {
    m.convert.mockResolvedValue({ ok: true, block: { id: 'b1', type: 'code_section' } })
    const res = await post({ blockId: 'b1' })
    expect(await res.json()).toEqual({ block: { id: 'b1', type: 'code_section' } })
    expect(m.convert).toHaveBeenCalledWith(BLOCK, 'showcase')
  })

  it('422s when the kind cannot be converted, or the conversion has issues', async () => {
    m.convert.mockResolvedValue(null)
    expect((await post({ blockId: 'b1' })).status).toBe(422)
    m.convert.mockResolvedValue({ ok: false, issues: [{ message: 'Bad markup' }] })
    const res = await post({ blockId: 'b1' })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Bad markup' })
  })
})
