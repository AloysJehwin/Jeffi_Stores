import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/ai/billing', () => {
  class AiWalletError extends Error {
    status = 402 as const
    constructor(message: string, public balanceInr: number, public neededInr: number) {
      super(message)
    }
  }
  return { AiWalletError }
})
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down', siteAiAvailable: vi.fn() }))
vi.mock('@/lib/site/studio/generate', () => ({ tweakSection: vi.fn() }))
vi.mock('@/lib/site/studio/context', () => ({ studioCtxFor: vi.fn() }))
vi.mock('@/lib/site/studio/redesign', () => ({ draftStudioContext: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/site-builder/ai/code/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { AiWalletError } from '@/lib/ai/billing'
import { siteAiAvailable } from '@/lib/site/ai-status'
import { tweakSection } from '@/lib/site/studio/generate'
import { studioCtxFor } from '@/lib/site/studio/context'
import { draftStudioContext } from '@/lib/site/studio/redesign'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const DRAFT = '11111111-1111-4111-8111-111111111111'
const BODY = { ref: { audience: 'store', page: 'home' }, block: { id: 'b1', label: 'Hero', source: 'export default () => null' }, instruction: 'make it bolder' }
const allow = (...granted: string[]) => vi.mocked(hasScope).mockImplementation((_r, _s, scope) => granted.includes(scope))
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/ai/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  allow('catalog_enrichment:write', 'settings:write')
  vi.mocked(siteAiAvailable).mockResolvedValue(true)
  vi.mocked(draftStudioContext).mockResolvedValue(null as any)
  vi.mocked(studioCtxFor).mockResolvedValue({ ctx: { c: 1 }, key: 'k1' } as any)
  vi.mocked(tweakSection).mockResolvedValue({ props: { source: 'NEW SOURCE' } } as any)
})

describe('POST /api/admin/site-builder/ai/code', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(BODY))).status).toBe(401)
    expect(tweakSection).not.toHaveBeenCalled()
  })

  it.each([[['settings:write']], [['catalog_enrichment:write']]])('returns 403 when granted only %j', async (granted) => {
    allow(...granted)
    expect((await POST(req(BODY))).status).toBe(403)
    expect(tweakSection).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ ...BODY, instruction: 'x' }], [{ ...BODY, block: { id: 'b1', source: '' } }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(req(body))).status).toBe(400)
    expect(tweakSection).not.toHaveBeenCalled()
  })

  it('returns 503 and makes no AI call while the AI is unavailable', async () => {
    vi.mocked(siteAiAvailable).mockResolvedValue(false)
    const res = await POST(req(BODY))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'AI is down', code: 'ai_unavailable' })
    expect(tweakSection).not.toHaveBeenCalled()
  })

  it('returns the changed source from the mocked AI, with the pointed-at hint in the ask', async () => {
    const res = await POST(req({ ...BODY, hint: 'the title', draftId: DRAFT }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ source: 'NEW SOURCE', summary: 'Changed Hero' })
    expect(draftStudioContext).toHaveBeenCalledWith(DRAFT)
    expect(studioCtxFor).toHaveBeenCalledWith({ audience: 'store', page: 'home' }, null)
    const [ctx, block, ask, key] = vi.mocked(tweakSection).mock.calls[0]
    expect(ctx).toEqual({ c: 1 })
    expect(block).toMatchObject({ id: 'b1', type: 'code_section', props: { label: 'Hero', source: 'export default () => null' } })
    expect(ask).toBe('make it bolder (They pointed at: "the title")')
    expect(key).toBe('k1')
  })

  it('does not look up a draft context without a draftId', async () => {
    await POST(req(BODY))
    expect(draftStudioContext).not.toHaveBeenCalled()
  })

  it('relays a wallet shortfall as 402 with the balance and the amount needed', async () => {
    vi.mocked(tweakSection).mockRejectedValue(new AiWalletError('Top up the AI wallet', 1, 5))
    const res = await POST(req(BODY))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ error: 'Top up the AI wallet', balanceInr: 1, neededInr: 5 })
  })

  it('returns 503 when the studio AI is down mid-call', async () => {
    vi.mocked(tweakSection).mockRejectedValue(Object.assign(new Error('x'), { name: 'StudioAiDownError' }))
    const res = await POST(req(BODY))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ai_unavailable')
  })

  it('returns 422 when the AI could not make the change', async () => {
    vi.mocked(tweakSection).mockRejectedValue(new Error('The AI could not make that change'))
    const res = await POST(req(BODY))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('Try saying it another way.')
  })

  it('returns 502 for any other failure', async () => {
    vi.mocked(tweakSection).mockRejectedValue(new Error('network'))
    expect((await POST(req(BODY))).status).toBe(502)
  })
})
