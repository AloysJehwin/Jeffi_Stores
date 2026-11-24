import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/site/after-publish', () => ({ afterSiteChange: vi.fn() }))
vi.mock('@/lib/site/store', () => ({
  getPublishedPage: vi.fn(),
  importLegacyLayouts: vi.fn(),
  listSiteDrafts: vi.fn(),
  setSiteBuilderEnabled: vi.fn(),
  siteBuilderEnabled: vi.fn(),
}))

import { GET, POST } from '@admin/app/api/(admin)/admin/site-builder/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { afterSiteChange } from '@/lib/site/after-publish'
import { getPublishedPage, importLegacyLayouts, listSiteDrafts, setSiteBuilderEnabled, siteBuilderEnabled } from '@/lib/site/store'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: [] }
const denied = (status: number) => NextResponse.json({ error: 'no' }, { status })
const get = (qs = '') => new NextRequest(`http://localhost/api/admin/site-builder${qs}`)
const post = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(logAdminAudit).mockResolvedValue(undefined as any)
})

describe('GET /api/admin/site-builder', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await GET(get())).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('lists whether it is on, the published pages and the drafts', async () => {
    vi.mocked(siteBuilderEnabled).mockResolvedValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ page_key: 'home' }] as any)
    vi.mocked(listSiteDrafts).mockResolvedValue([{ id: 'd1' }] as any)
    const res = await GET(get())
    expect(await res.json()).toEqual({ enabled: true, pages: [{ page_key: 'home' }], drafts: [{ id: 'd1' }] })
  })

  it('returns a sample product, category, brand, search word and order for previews', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ slug: 'kettle', name: 'Red Kettle Deluxe' } as any)
      .mockResolvedValueOnce({ slug: 'home' } as any)
      .mockRejectedValueOnce(new Error('no brands table'))
      .mockResolvedValueOnce({ id: 'o1' } as any)
    const res = await GET(get('?sample=1'))
    expect(await res.json()).toEqual({ product: 'kettle', category: 'home', brand: null, search: 'Red', order: 'o1' })
  })

  it('returns nulls for a sample when the store is empty', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect(await (await GET(get('?sample=1'))).json()).toEqual({ product: null, category: null, brand: null, search: null, order: null })
  })

  it('returns the published theme tokens for the audience', async () => {
    vi.mocked(queryOne).mockResolvedValue({ tokens: { primary: '#fff' } } as any)
    expect(await (await GET(get('?theme=business'))).json()).toEqual({ tokens: { primary: '#fff' } })
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['business'])
    await GET(get('?theme=anything'))
    expect(vi.mocked(queryOne).mock.calls[1][1]).toEqual(['store'])
  })

  it('returns null tokens when no theme is published', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect(await (await GET(get('?theme=store'))).json()).toEqual({ tokens: null })
  })

  it('returns a page document by key, 400 for an unknown key and 404 when unpublished', async () => {
    vi.mocked(getPublishedPage).mockResolvedValueOnce({ doc: { order: [] }, version: 2 } as any)
    expect(await (await GET(get('?key=store:web:home:'))).json()).toEqual({ doc: { order: [] }, version: 2 })
    expect(getPublishedPage).toHaveBeenCalledWith({ audience: 'store', surface: 'web', page: 'home', slug: '' })
    expect((await GET(get('?key=bogus'))).status).toBe(400)
    vi.mocked(getPublishedPage).mockResolvedValueOnce(null as any)
    expect((await GET(get('?key=store:web:home:'))).status).toBe(404)
  })
})

describe('POST /api/admin/site-builder', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied(status) as any)
    expect((await POST(post({ enabled: true }))).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(setSiteBuilderEnabled).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{}], [{ enabled: 'yes' }], [{ setup: false }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(post(body))).status).toBe(400)
    expect(setSiteBuilderEnabled).not.toHaveBeenCalled()
  })

  it('setup imports the legacy layouts and does not switch the builder', async () => {
    vi.mocked(importLegacyLayouts).mockResolvedValue(4)
    const res = await POST(post({ setup: true }))
    expect(await res.json()).toEqual({ imported: 4 })
    expect(importLegacyLayouts).toHaveBeenCalledWith('a1')
    expect(setSiteBuilderEnabled).not.toHaveBeenCalled()
  })

  it('turning it on imports layouts, saves the switch, refreshes the site and audits', async () => {
    vi.mocked(importLegacyLayouts).mockResolvedValue(3)
    const res = await POST(post({ enabled: true }))
    expect(await res.json()).toEqual({ enabled: true, imported: 3 })
    expect(setSiteBuilderEnabled).toHaveBeenCalledWith(true)
    expect(afterSiteChange).toHaveBeenCalled()
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', entityType: 'site_builder', summary: 'Turned Site Builder on (3 layouts imported)' }))
  })

  it('turning it off imports nothing and audits it', async () => {
    const res = await POST(post({ enabled: false }))
    expect(await res.json()).toEqual({ enabled: false, imported: 0 })
    expect(importLegacyLayouts).not.toHaveBeenCalled()
    expect(setSiteBuilderEnabled).toHaveBeenCalledWith(false)
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Turned Site Builder off' }))
  })

  it('still succeeds when the audit log write fails', async () => {
    vi.mocked(logAdminAudit).mockRejectedValue(new Error('audit down'))
    expect((await POST(post({ enabled: false }))).status).toBe(200)
  })

  it('lets a failing switch propagate', async () => {
    vi.mocked(setSiteBuilderEnabled).mockRejectedValue(new Error('db'))
    await expect(POST(post({ enabled: false }))).rejects.toThrow('db')
    expect(afterSiteChange).not.toHaveBeenCalled()
  })
})
