import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/site/compose', () => ({ aiComposeBlock: vi.fn() }))
vi.mock('@/lib/site/ai', () => {
  class SiteAiError extends Error {}
  return { SiteAiError }
})

import { POST } from '@admin/app/api/(admin)/admin/site-builder/ai/compose/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { aiComposeBlock } from '@/lib/site/compose'
import { SiteAiError } from '@/lib/site/ai'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const allow = (...granted: string[]) => vi.mocked(hasScope).mockImplementation((_r, _s, scope) => granted.includes(scope))
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/ai/compose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  allow('catalog_enrichment:write', 'settings:write')
})

describe('POST /api/admin/site-builder/ai/compose', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ page: 'home', prompt: 'a banner' }))).status).toBe(401)
    expect(aiComposeBlock).not.toHaveBeenCalled()
  })

  it.each([[['settings:write']], [['catalog_enrichment:write']]])('returns 403 when granted only %j', async (granted) => {
    allow(...granted)
    expect((await POST(req({ page: 'home', prompt: 'a banner' }))).status).toBe(403)
    expect(aiComposeBlock).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ page: 'home', prompt: 'ab' }], [{ page: 'bogus', prompt: 'a banner' }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(req(body))).status).toBe(400)
    expect(aiComposeBlock).not.toHaveBeenCalled()
  })

  it('composes the block and returns it without saving', async () => {
    vi.mocked(aiComposeBlock).mockResolvedValue({ label: 'Banner', tree: { t: 1 } } as any)
    const res = await POST(req({ page: 'home', prompt: '  a banner  ', hint: 'top' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ label: 'Banner', tree: { t: 1 } })
    expect(aiComposeBlock).toHaveBeenCalledWith({ page: 'home', prompt: 'a banner', hint: 'top' })
  })

  it('returns 422 for a SiteAiError', async () => {
    vi.mocked(aiComposeBlock).mockRejectedValue(new SiteAiError('Not composable'))
    const res = await POST(req({ page: 'home', prompt: 'a banner' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Not composable' })
  })

  it('returns 502 when the AI is unreachable', async () => {
    vi.mocked(aiComposeBlock).mockRejectedValue(new Error('timeout'))
    expect((await POST(req({ page: 'home', prompt: 'a banner' }))).status).toBe(502)
  })
})
