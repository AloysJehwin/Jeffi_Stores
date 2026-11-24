import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/catalog/homepage-plan', () => ({ getHomepagePlan: vi.fn() }))
vi.mock('@/lib/site/ai', () => {
  class SiteAiError extends Error {}
  return { SiteAiError, aiBuildPage: vi.fn(), aiCorrectBlock: vi.fn() }
})

import { POST } from '@admin/app/api/(admin)/admin/site-builder/ai/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getHomepagePlan } from '@/lib/catalog/homepage-plan'
import { aiBuildPage, aiCorrectBlock, SiteAiError } from '@/lib/site/ai'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const REF = { audience: 'store', surface: 'web', page: 'home' }
const DOC = { blocks: { b1: { id: 'b1', type: 'hero', v: 1, props: {} } }, order: ['b1'] }
const allow = (...granted: string[]) => vi.mocked(hasScope).mockImplementation((_r, _s, scope) => granted.includes(scope))
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  allow('catalog_enrichment:write', 'settings:write')
  vi.mocked(getHomepagePlan).mockResolvedValue({ types: ['hero', 'products'] } as any)
})

describe('POST /api/admin/site-builder/ai', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ ref: REF, doc: DOC, prompt: 'make it pop' }))).status).toBe(401)
    expect(aiBuildPage).not.toHaveBeenCalled()
  })

  it('returns 403 when the plan lacks AI tools', async () => {
    allow('settings:write')
    const res = await POST(req({ ref: REF, doc: DOC, prompt: 'make it pop' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/AI tools are not available/)
    expect(aiBuildPage).not.toHaveBeenCalled()
  })

  it('returns 403 without settings:write', async () => {
    allow('catalog_enrichment:write')
    const res = await POST(req({ ref: REF, doc: DOC, prompt: 'make it pop' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Insufficient permissions' })
    expect(aiBuildPage).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ ref: REF, doc: DOC, prompt: 'hi' }], [{ ref: { ...REF, page: 'nope' }, doc: DOC, prompt: 'make it pop' }], [{ ref: REF, prompt: 'make it pop' }]])(
    'returns 400 for a bad body (%j)',
    async (body) => {
      expect((await POST(req(body))).status).toBe(400)
      expect(aiBuildPage).not.toHaveBeenCalled()
      expect(aiCorrectBlock).not.toHaveBeenCalled()
    }
  )

  it('builds the page from the request with the homepage plan block types', async () => {
    vi.mocked(aiBuildPage).mockResolvedValue({ doc: DOC, summary: 'built' } as any)
    const res = await POST(req({ ref: REF, doc: DOC, prompt: 'a bold homepage' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ doc: DOC, summary: 'built' })
    const [doc, ref, prompt, types] = vi.mocked(aiBuildPage).mock.calls[0]
    expect(doc.order).toEqual(['b1'])
    expect(ref).toEqual(REF)
    expect(prompt).toBe('a bold homepage')
    expect(types).toEqual(['hero', 'products'])
    expect(aiCorrectBlock).not.toHaveBeenCalled()
  })

  it('corrects one block when blockId is given', async () => {
    vi.mocked(aiCorrectBlock).mockResolvedValue({ doc: DOC } as any)
    const res = await POST(req({ ref: REF, doc: DOC, prompt: 'shorter title', blockId: 'b1', hint: 'the title' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(aiCorrectBlock).mock.calls[0].slice(1)).toEqual([REF, 'b1', 'shorter title', 'the title'])
    expect(aiBuildPage).not.toHaveBeenCalled()
  })

  it('returns 422 with the message of a SiteAiError', async () => {
    vi.mocked(aiBuildPage).mockRejectedValue(new SiteAiError('The AI sent an invalid page'))
    const res = await POST(req({ ref: REF, doc: DOC, prompt: 'a bold homepage' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'The AI sent an invalid page' })
  })

  it('returns 502 when the AI is unreachable', async () => {
    vi.mocked(aiBuildPage).mockRejectedValue(new Error('ECONNRESET'))
    const res = await POST(req({ ref: REF, doc: DOC, prompt: 'a bold homepage' }))
    expect(res.status).toBe(502)
  })
})
