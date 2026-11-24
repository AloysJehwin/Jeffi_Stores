import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/site/code/compile', () => ({ upgradeCodeSections: vi.fn((doc: unknown) => ({ upgraded: doc })) }))
vi.mock('@/lib/site/store', () => ({ getPublishedPage: vi.fn(), getSiteDraft: vi.fn(), siteEditorEnabled: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/site-builder/drafts/[id]/editor/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { upgradeCodeSections } from '@/lib/site/code/compile'
import { getPublishedPage, getSiteDraft, siteEditorEnabled } from '@/lib/site/store'

const ctx = { params: Promise.resolve({ id: 'd1' }) }
const KEY = 'store:web:home:'
const req = (qs = `?key=${KEY}`) => new NextRequest(`http://localhost/api/admin/site-builder/drafts/d1/editor${qs}`)
const doc = (title: string) => ({ order: ['b1'], blocks: { b1: { id: 'b1', type: 'hero', v: 1, props: { title } } } })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(upgradeCodeSections).mockImplementation(((d: unknown) => ({ upgraded: d })) as any)
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(siteEditorEnabled).mockResolvedValue(true)
  vi.mocked(getSiteDraft).mockResolvedValue({ docs: { pages: {} } } as any)
  vi.mocked(getPublishedPage).mockResolvedValue(null as any)
})

describe('GET /api/admin/site-builder/drafts/[id]/editor', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await GET(req(), ctx)).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('returns 404 while the visual editor is off', async () => {
    vi.mocked(siteEditorEnabled).mockResolvedValue(false)
    expect((await GET(req(), ctx)).status).toBe(404)
  })

  it('returns 404 for a missing draft', async () => {
    vi.mocked(getSiteDraft).mockResolvedValue(null as any)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Draft not found' })
  })

  it.each([[''], ['?key=bogus'], ['?key=store:web_mobile:home:'], ['?key=store:app:home:']])('returns 400 for a non desktop-web key (%s)', async (qs) => {
    expect((await GET(req(qs), ctx)).status).toBe(400)
  })

  it('opens the draft page and reports no phone layout', async () => {
    vi.mocked(getSiteDraft).mockResolvedValue({ docs: { pages: { [KEY]: doc('Draft') } } } as any)
    const res = await GET(req(), ctx)
    const body = await res.json()
    expect(body.phone).toBe('none')
    expect(body.doc.upgraded.blocks.b1.props.title).toBe('Draft')
    expect(upgradeCodeSections).toHaveBeenCalledWith(expect.anything(), 'home')
  })

  it('falls back to the published page when the draft has no copy', async () => {
    vi.mocked(getPublishedPage).mockImplementation((async (ref: any) => (ref.surface === 'web' ? { doc: doc('Live') } : null)) as any)
    const body = await (await GET(req(), ctx)).json()
    expect(body.doc.upgraded.blocks.b1.props.title).toBe('Live')
  })

  it('reports "same" when the phone page equals desktop, ignoring compiled output', async () => {
    const phone = doc('Same')
    ;(phone.blocks.b1.props as any).compiled = 'x'
    vi.mocked(getSiteDraft).mockResolvedValue({ docs: { pages: { [KEY]: doc('Same'), 'store:web_mobile:home:': phone } } } as any)
    expect((await (await GET(req(), ctx)).json()).phone).toBe('same')
  })

  it('reports "own" when the phone page differs', async () => {
    vi.mocked(getSiteDraft).mockResolvedValue({ docs: { pages: { [KEY]: doc('Desk'), 'store:web_mobile:home:': doc('Phone') } } } as any)
    expect((await (await GET(req(), ctx)).json()).phone).toBe('own')
  })
})
