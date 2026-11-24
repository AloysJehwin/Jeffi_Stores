import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/site/studio/ui-styles', () => ({ UI_STYLE_IDS: ['clean', 'bold'] }))
vi.mock('@/lib/site/studio/redesign', () => ({ activeRedesign: vi.fn(), currentDesign: vi.fn(), redesignStatus: vi.fn() }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down', siteAiAvailable: vi.fn() }))
vi.mock('@/lib/site/site-generation', () => {
  class SiteGenerationRefused extends Error {
    status = 409
    constructor(readonly code: 'busy' | 'not_resumable', message: string) {
      super(message)
    }
    body() {
      return { error: this.message, code: this.code }
    }
  }
  return { SiteGenerationRefused, siteGenerationQuote: vi.fn(), startSiteGeneration: vi.fn() }
})
vi.mock('@/lib/ai/paid-generation', () => {
  class PaidGenerationError extends Error {
    status = 402
    constructor(readonly code: 'wallet_low' | 'duplicate' | 'price_changed', message: string) {
      super(message)
    }
    body() {
      return { error: this.message, code: this.code }
    }
  }
  return { PaidGenerationError }
})

import { GET, POST } from '@admin/app/api/(admin)/admin/site-builder/ai/site/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { activeRedesign, currentDesign, redesignStatus } from '@/lib/site/studio/redesign'
import { siteAiAvailable } from '@/lib/site/ai-status'
import { SiteGenerationRefused, siteGenerationQuote, startSiteGeneration } from '@/lib/site/site-generation'
import { PaidGenerationError } from '@/lib/ai/paid-generation'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const DRAFT = '11111111-1111-4111-8111-111111111111'
const post = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/ai/site', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })
const get = (qs = '') => new NextRequest(`http://localhost/api/admin/site-builder/ai/site${qs}`)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(siteAiAvailable).mockResolvedValue(true)
  vi.mocked(startSiteGeneration).mockResolvedValue({ draftId: DRAFT } as any)
})

describe('POST /api/admin/site-builder/ai/site', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(post({}))).status).toBe(401)
    expect(startSiteGeneration).not.toHaveBeenCalled()
  })

  it('returns 403 without settings:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(post({}))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ['settings'], 'settings:write')
    expect(startSiteGeneration).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ design: 'nope' }], [{ reference: 'http://insecure.example' }], [{ resume: 'not-a-uuid' }], [{ expect: 'maybe' }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(post(body))).status).toBe(400)
    expect(startSiteGeneration).not.toHaveBeenCalled()
  })

  it('returns 503 and starts no generation while the AI is unavailable', async () => {
    vi.mocked(siteAiAvailable).mockResolvedValue(false)
    const res = await POST(post({}))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ai_unavailable')
    expect(startSiteGeneration).not.toHaveBeenCalled()
  })

  it('starts a free-priced generation with the defaults and answers 202', async () => {
    const res = await POST(post({}))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ draftId: DRAFT })
    expect(startSiteGeneration).toHaveBeenCalledWith({ design: 'keep', colours: 'keep' }, 'a1', { acceptPaid: false, resume: undefined })
  })

  it('accepts a paid generation only when the shown price is confirmed', async () => {
    await POST(post({ design: 'bold', colours: 'new', reference: 'https://ref.example/x', expect: 'paid', resume: DRAFT }))
    expect(startSiteGeneration).toHaveBeenCalledWith({ design: 'bold', colours: 'new', reference: 'https://ref.example/x' }, 'a1', { acceptPaid: true, resume: DRAFT })
  })

  it('relays a paid-generation or busy refusal with its status and body', async () => {
    vi.mocked(startSiteGeneration).mockRejectedValueOnce(new PaidGenerationError('wallet_low', 'Wallet too low'))
    const low = await POST(post({ expect: 'paid' }))
    expect(low.status).toBe(402)
    expect(await low.json()).toEqual({ error: 'Wallet too low', code: 'wallet_low' })
    vi.mocked(startSiteGeneration).mockRejectedValueOnce(new SiteGenerationRefused('busy', 'Another build is running'))
    const busy = await POST(post({}))
    expect(busy.status).toBe(409)
    expect(await busy.json()).toEqual({ error: 'Another build is running', code: 'busy' })
  })

  it('rethrows an unexpected failure', async () => {
    vi.mocked(startSiteGeneration).mockRejectedValue(new Error('db'))
    await expect(POST(post({}))).rejects.toThrow('db')
  })
})

describe('GET /api/admin/site-builder/ai/site', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(get())).status).toBe(401)
  })

  it('without a draft returns availability, the quote, the active build and the current design', async () => {
    vi.mocked(siteGenerationQuote).mockResolvedValue({ free: true } as any)
    vi.mocked(activeRedesign).mockResolvedValue({ id: 'r1' } as any)
    vi.mocked(currentDesign).mockResolvedValue({ style: 'clean' } as any)
    const res = await GET(get('?fresh=1'))
    expect(await res.json()).toEqual({ available: true, quote: { free: true }, active: { id: 'r1' }, current: { style: 'clean' } })
    expect(siteAiAvailable).toHaveBeenCalledWith(undefined, { fresh: true })
  })

  it('tolerates failing quote, active and current lookups', async () => {
    vi.mocked(siteGenerationQuote).mockRejectedValue(new Error('x'))
    vi.mocked(activeRedesign).mockRejectedValue(new Error('x'))
    vi.mocked(currentDesign).mockRejectedValue(new Error('x'))
    const res = await GET(get())
    expect(await res.json()).toEqual({ available: true, quote: null, active: null, current: null })
    expect(siteAiAvailable).toHaveBeenCalledWith(undefined, { fresh: false })
  })

  it('returns 400 for a malformed draft id', async () => {
    expect((await GET(get('?draft=zzz'))).status).toBe(400)
    expect(redesignStatus).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown draft and the progress for a known one', async () => {
    vi.mocked(redesignStatus).mockResolvedValueOnce(undefined as any)
    const missing = await GET(get(`?draft=${DRAFT}`))
    expect(missing.status).toBe(404)
    expect((await missing.json()).code).toBe('no_draft')
    vi.mocked(redesignStatus).mockResolvedValueOnce({ pages: 3 } as any)
    expect(await (await GET(get(`?draft=${DRAFT}`))).json()).toEqual({ ai: { pages: 3 } })
  })
})
