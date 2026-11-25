import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/site/after-publish', () => ({ afterSiteChange: vi.fn() }))
vi.mock('@/lib/site/studio/context', () => ({ saveStudioContext: vi.fn() }))
vi.mock('@/lib/site/studio/redesign', () => ({ draftStudioContext: vi.fn() }))
vi.mock('@/lib/site/store', () => {
  class SiteDocInvalid extends Error {
    constructor(readonly issues: { blockId?: string; message: string }[], message = 'Invalid page') {
      super(message)
    }
  }
  return {
    SiteDocInvalid,
    discardSiteDraft: vi.fn(),
    editorDraft: vi.fn(),
    getSiteDraft: vi.fn(),
    publishSiteDraft: vi.fn(),
    saveDraftPage: vi.fn(),
    saveDraftTheme: vi.fn(),
  }
})

import { DELETE, GET, POST, PUT } from '@admin/app/api/(admin)/admin/site-builder/drafts/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { afterSiteChange } from '@/lib/site/after-publish'
import { saveStudioContext } from '@/lib/site/studio/context'
import { draftStudioContext } from '@/lib/site/studio/redesign'
import { discardSiteDraft, editorDraft, getSiteDraft, publishSiteDraft, saveDraftPage, saveDraftTheme, SiteDocInvalid } from '@/lib/site/store'

const ID = 'd1'
const ctx = { params: Promise.resolve({ id: ID }) }
const denied = (status: number) => NextResponse.json({ error: 'no' }, { status })
const url = `http://localhost/api/admin/site-builder/drafts/${ID}`
const withBody = (method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? 'nope' : JSON.stringify(body) })
const REF = { audience: 'store', surface: 'web', page: 'home' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(logAdminAudit).mockResolvedValue(undefined as any)
})

describe('GET /api/admin/site-builder/drafts/[id]', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await GET(new NextRequest(url), ctx)).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('returns 404 for a missing draft', async () => {
    vi.mocked(getSiteDraft).mockResolvedValue(null as any)
    expect((await GET(new NextRequest(url), ctx)).status).toBe(404)
  })

  it('returns the draft, or the editor version with ?tree=1', async () => {
    vi.mocked(getSiteDraft).mockResolvedValue({ id: ID } as any)
    vi.mocked(editorDraft).mockResolvedValue({ id: ID, trees: true } as any)
    expect(await (await GET(new NextRequest(url), ctx)).json()).toEqual({ draft: { id: ID } })
    expect(await (await GET(new NextRequest(`${url}?tree=1`), ctx)).json()).toEqual({ draft: { id: ID, trees: true } })
    expect(editorDraft).toHaveBeenCalledWith({ id: ID })
  })
})

describe('PUT /api/admin/site-builder/drafts/[id]', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await PUT(withBody('PUT', { page: { ref: REF, doc: {} } }), ctx)).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(saveDraftPage).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ page: { ref: { ...REF, page: 'bogus' }, doc: {} } }], [{ theme: { audience: 'nope', tokens: {} } }], [{ page: { ref: { ...REF, slug: 'Bad Slug' }, doc: {} } }]])(
    'returns 400 for a bad body (%j)',
    async (body) => {
      expect((await PUT(withBody('PUT', body), ctx)).status).toBe(400)
      expect(saveDraftPage).not.toHaveBeenCalled()
    }
  )

  it('saves the page document into the draft', async () => {
    vi.mocked(saveDraftPage).mockResolvedValue({ saved: true } as any)
    const res = await PUT(withBody('PUT', { page: { ref: REF, doc: { order: [] } } }), ctx)
    expect(await res.json()).toEqual({ doc: { saved: true } })
    expect(saveDraftPage).toHaveBeenCalledWith(ID, REF, { order: [] }, 'a1')
    expect(saveDraftTheme).not.toHaveBeenCalled()
  })

  it('saves a page and a theme together', async () => {
    vi.mocked(saveDraftPage).mockResolvedValue('D' as any)
    vi.mocked(saveDraftTheme).mockResolvedValue('T' as any)
    const res = await PUT(withBody('PUT', { page: { ref: REF, doc: {} }, theme: { audience: 'business', tokens: { a: 1 } } }), ctx)
    expect(await res.json()).toEqual({ doc: 'D', theme: 'T' })
    expect(saveDraftTheme).toHaveBeenCalledWith(ID, 'business', { a: 1 }, 'a1')
  })

  it('returns 400 with the issues for an invalid document', async () => {
    vi.mocked(saveDraftPage).mockRejectedValue(new SiteDocInvalid([{ message: 'bad block' }]))
    const res = await PUT(withBody('PUT', { page: { ref: REF, doc: {} } }), ctx)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid page', issues: [{ message: 'bad block' }] })
  })

  it('returns 404 when the draft is gone and rethrows other failures', async () => {
    vi.mocked(saveDraftPage).mockRejectedValueOnce(new Error('Draft not found'))
    expect((await PUT(withBody('PUT', { page: { ref: REF, doc: {} } }), ctx)).status).toBe(404)
    vi.mocked(saveDraftPage).mockRejectedValueOnce(new Error('db'))
    await expect(PUT(withBody('PUT', { page: { ref: REF, doc: {} } }), ctx)).rejects.toThrow('db')
  })
})

describe('POST /api/admin/site-builder/drafts/[id] (publish)', () => {
  const PUBLISHED = { pages: ['store:web:home:'], theme: ['store'], conflicts: [] }

  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await POST(new NextRequest(url, { method: 'POST' }), ctx)).status).toBe(status)
    expect(publishSiteDraft).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing draft and does not refresh or audit', async () => {
    vi.mocked(publishSiteDraft).mockResolvedValue(null as any)
    expect((await POST(new NextRequest(url, { method: 'POST' }), ctx)).status).toBe(404)
    expect(afterSiteChange).not.toHaveBeenCalled()
    expect(logAdminAudit).not.toHaveBeenCalled()
  })

  it('publishes, keeps the studio context, refreshes the site and audits the page count', async () => {
    vi.mocked(draftStudioContext).mockResolvedValue({ brief: 'b' } as any)
    vi.mocked(publishSiteDraft).mockResolvedValue(PUBLISHED as any)
    vi.mocked(saveStudioContext).mockResolvedValue(undefined as any)
    const res = await POST(new NextRequest(url, { method: 'POST' }), ctx)
    expect(await res.json()).toEqual({ published: PUBLISHED })
    expect(publishSiteDraft).toHaveBeenCalledWith(ID, 'a1')
    expect(saveStudioContext).toHaveBeenCalledWith({ brief: 'b' })
    expect(afterSiteChange).toHaveBeenCalled()
    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: ID, summary: 'Published a Site Builder draft (1 pages, theme)', metadata: { pages: PUBLISHED.pages, conflicts: [] } })
    )
  })

  it('skips the studio context when the draft has none and survives failing side effects', async () => {
    vi.mocked(draftStudioContext).mockResolvedValue(null as any)
    vi.mocked(publishSiteDraft).mockResolvedValue({ pages: [], theme: [], conflicts: [] } as any)
    vi.mocked(logAdminAudit).mockRejectedValue(new Error('audit'))
    expect((await POST(new NextRequest(url, { method: 'POST' }), ctx)).status).toBe(200)
    expect(saveStudioContext).not.toHaveBeenCalled()
    vi.mocked(draftStudioContext).mockResolvedValue({ brief: 'b' } as any)
    vi.mocked(saveStudioContext).mockRejectedValue(new Error('ctx'))
    expect((await POST(new NextRequest(url, { method: 'POST' }), ctx)).status).toBe(200)
  })
})

describe('DELETE /api/admin/site-builder/drafts/[id]', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await DELETE(new NextRequest(url, { method: 'DELETE' }), ctx)).status).toBe(status)
    expect(discardSiteDraft).not.toHaveBeenCalled()
  })

  it('discards the draft', async () => {
    vi.mocked(discardSiteDraft).mockResolvedValue(true as any)
    expect(await (await DELETE(new NextRequest(url, { method: 'DELETE' }), ctx)).json()).toEqual({ ok: true })
    expect(discardSiteDraft).toHaveBeenCalledWith(ID)
  })

  it('returns 404 when there is no such draft', async () => {
    vi.mocked(discardSiteDraft).mockResolvedValue(false as any)
    expect((await DELETE(new NextRequest(url, { method: 'DELETE' }), ctx)).status).toBe(404)
  })
})
