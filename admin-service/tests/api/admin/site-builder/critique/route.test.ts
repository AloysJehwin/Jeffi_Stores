import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/site/critique', () => ({ critiquePage: vi.fn(), fixPage: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ getPublishedTheme: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/site-builder/critique/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { critiquePage, fixPage } from '@/lib/site/critique'
import { getPublishedTheme } from '@/lib/site/store'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const REF = { audience: 'store', surface: 'web', page: 'home' }
const DOC = { blocks: { b1: { id: 'b1', type: 'hero', v: 1, props: {} } }, order: ['b1'] }
const allow = (...granted: string[]) => vi.mocked(hasScope).mockImplementation((_r, _s, scope) => granted.includes(scope))
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/critique', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  allow('catalog_enrichment:write', 'settings:write')
  vi.mocked(getPublishedTheme).mockResolvedValue({ colors: { primary: '#000' } } as any)
  vi.mocked(critiquePage).mockResolvedValue([{ id: 'f1', message: 'empty hero' }] as any)
})

describe('POST /api/admin/site-builder/critique', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ ref: REF, doc: DOC }))).status).toBe(401)
    expect(critiquePage).not.toHaveBeenCalled()
  })

  it.each([[['settings:write']], [['catalog_enrichment:write']]])('returns 403 when granted only %j', async (granted) => {
    allow(...granted)
    expect((await POST(req({ ref: REF, doc: DOC }))).status).toBe(403)
    expect(critiquePage).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ ref: REF }], [{ ref: { ...REF, page: 'bogus' }, doc: DOC }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(req(body))).status).toBe(400)
    expect(critiquePage).not.toHaveBeenCalled()
  })

  it('returns the findings only, using the published theme for the audience', async () => {
    const res = await POST(req({ ref: REF, doc: DOC }))
    expect(await res.json()).toEqual({ findings: [{ id: 'f1', message: 'empty hero' }] })
    expect(getPublishedTheme).toHaveBeenCalledWith('store')
    expect(fixPage).not.toHaveBeenCalled()
  })

  it('skips the published theme lookup when the editor sends its theme', async () => {
    await POST(req({ ref: REF, doc: DOC, theme: { colors: { primary: '#f00' } } }))
    expect(getPublishedTheme).not.toHaveBeenCalled()
  })

  it('with fix, applies the fixes, critiques again and returns the fixed page and theme', async () => {
    vi.mocked(fixPage).mockResolvedValue({ fixed: 2, doc: { order: ['b1'], blocks: {} }, theme: { t: 1 } } as any)
    vi.mocked(critiquePage).mockResolvedValueOnce([{ id: 'f1' }] as any).mockResolvedValueOnce([] as any)
    const res = await POST(req({ ref: REF, doc: DOC, fix: true }))
    expect(await res.json()).toEqual({ findings: [], fixed: 2, doc: { order: ['b1'], blocks: {} }, theme: { t: 1 } })
    expect(critiquePage).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fixPage).mock.calls[0][1]).toEqual([{ id: 'f1' }])
  })

  it('with fix but nothing fixable, keeps the original findings and returns no doc', async () => {
    vi.mocked(fixPage).mockResolvedValue({ fixed: 0, doc: DOC, theme: null } as any)
    const res = await POST(req({ ref: REF, doc: DOC, fix: true }))
    expect(await res.json()).toEqual({ findings: [{ id: 'f1', message: 'empty hero' }], fixed: 0, doc: null, theme: null })
    expect(critiquePage).toHaveBeenCalledTimes(1)
  })

  it('lets a critique failure propagate', async () => {
    vi.mocked(critiquePage).mockRejectedValue(new Error('boom'))
    await expect(POST(req({ ref: REF, doc: DOC }))).rejects.toThrow('boom')
  })
})
