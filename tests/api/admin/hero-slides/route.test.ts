import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeHomepageDraftDb, slideRow } from '../../../helpers/homepage-draft-db'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const { mockUpload, mockRun } = vi.hoisted(() => ({ mockUpload: vi.fn(), mockRun: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ uploadGalleryImage: mockUpload }))
vi.mock('replicate', () => ({
  default: class {
    run = mockRun
  },
}))

const fake = makeHomepageDraftDb()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => fake.db.query(...(a as [string, any[]])),
  queryOne: (...a: any[]) => fake.db.queryOne(...(a as [string])),
  queryMany: (...a: any[]) => fake.db.queryMany(...(a as [string])),
  withTransaction: (fn: any) => fake.db.withTransaction(fn),
}))

import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { GET, POST, PATCH } from '@/app/api/admin/hero-slides/route'
import { PATCH as PATCH_ONE, DELETE } from '@/app/api/admin/hero-slides/[id]/route'
import { POST as UPLOAD } from '@/app/api/admin/hero-slides/[id]/image/route'
import { POST as GENERATE } from '@/app/api/admin/hero-slides/[id]/generate-image/route'

const ADMIN_ID = '22222222-2222-4222-8222-222222222222'
const admin = { adminId: ADMIN_ID, role: 'super_admin', scopes: [] }
const S1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const S2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const MISSING = 'bbbbbbbb-0000-4000-8000-00000000ffff'
const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) })

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/hero-slides', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}
function badReq(method: string) {
  return new NextRequest('http://localhost/api/admin/hero-slides', {
    method,
    body: 'not-json{',
    headers: { 'Content-Type': 'application/json' },
  })
}
function uploadReq(fields: Record<string, string | File>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new NextRequest('http://localhost/api/admin/hero-slides/x/image', { method: 'POST', body: form })
}
const png = () => new File(['png-bytes'], 'banner.png', { type: 'image/png' })

const liveWrites = () => fake.state.statements.filter(s => /^(INSERT INTO|UPDATE|DELETE FROM) hero_slides/.test(s))
const draftSlide = (id: string) => fake.state.draft!.hero_slides.find(s => s.id === id)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  vi.mocked(hasScope).mockReturnValue(true)
  mockUpload.mockResolvedValue({ url: 'https://cdn.example.com/gallery/new.png', blurhash: 'LEHV6nWB2yk8' })
  fake.reset({ heroSlides: [slideRow(S1, 0), slideRow(S2, 1)] })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('authorization', () => {
  it('401s every handler when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('GET'))).status).toBe(401)
    expect((await POST(req('POST', { title: 'Hi' }))).status).toBe(401)
    expect((await PATCH(req('PATCH', { order: [S1] }))).status).toBe(401)
    expect((await PATCH_ONE(req('PATCH', { title: 'x' }), paramsFor(S1))).status).toBe(401)
    expect((await DELETE(req('DELETE'), paramsFor(S1))).status).toBe(401)
    expect((await UPLOAD(uploadReq({ file: png() }), paramsFor(S1))).status).toBe(401)
  })

  it('403s without the settings:write scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req('GET'))).status).toBe(403)
    expect((await POST(req('POST', { title: 'Hi' }))).status).toBe(403)
    expect((await PATCH(req('PATCH', { order: [S1] }))).status).toBe(403)
    expect((await PATCH_ONE(req('PATCH', { title: 'x' }), paramsFor(S1))).status).toBe(403)
    expect((await DELETE(req('DELETE'), paramsFor(S1))).status).toBe(403)
    expect((await UPLOAD(uploadReq({ file: png() }), paramsFor(S1))).status).toBe(403)
    expect(fake.state.draft).toBeNull()
  })
})

describe('GET /api/admin/hero-slides', () => {
  it('returns the live slides while there is no draft', async () => {
    const data = await (await GET(req('GET'))).json()
    expect(data.slides.map((s: any) => s.id)).toEqual([S1, S2])
  })

  it('returns the draft slides once a draft exists', async () => {
    await DELETE(req('DELETE'), paramsFor(S1))
    const data = await (await GET(req('GET'))).json()
    expect(data.slides.map((s: any) => s.id)).toEqual([S2])
  })
})

describe('POST /api/admin/hero-slides', () => {
  it('400 validation failure (missing title)', async () => {
    expect((await POST(req('POST', {}))).status).toBe(400)
    expect(fake.state.draft).toBeNull()
  })

  it('creates the slide in the draft with the table defaults', async () => {
    const res = await POST(req('POST', { title: 'Hi' }))
    expect(res.status).toBe(200)
    const { slide } = await res.json()
    expect(slide).toMatchObject({
      title: 'Hi',
      badge_color: 'bg-primary-500',
      filter_in_stock: false,
      filter_on_sale: false,
      is_active: true,
      display_order: 2,
      image_url: null,
      blurhash: null,
    })
    expect(fake.state.draft!.hero_slides.map(s => s.id)).toEqual([S1, S2, slide.id])
    expect(fake.state.draft!.updated_by).toBe(ADMIN_ID)
    expect(fake.state.live.hero_slides).toHaveLength(2)
    expect(liveWrites()).toEqual([])
  })

  it('maps every optional field onto the draft slide', async () => {
    const res = await POST(
      req('POST', {
        title: 'Full',
        subtitle: 'sub',
        badgeText: 'NEW',
        badgeColor: 'bg-red-500',
        imageUrl: '/a.jpg',
        imageUrlMobile: '/m.jpg',
        ctaLabel: 'Buy',
        ctaUrl: '/shop',
        filterCategory: 'cat',
        filterBrand: 'br',
        filterGrade: 'gr',
        filterMaterial: 'mat',
        filterMinPrice: 10,
        filterMaxPrice: 100,
        filterInStock: true,
        filterOnSale: true,
        isActive: false,
      })
    )
    const { slide } = await res.json()
    expect(slide).toMatchObject({
      subtitle: 'sub',
      badge_text: 'NEW',
      badge_color: 'bg-red-500',
      image_url: '/a.jpg',
      image_url_mobile: '/m.jpg',
      cta_label: 'Buy',
      cta_url: '/shop',
      filter_category: 'cat',
      filter_brand: 'br',
      filter_grade: 'gr',
      filter_material: 'mat',
      filter_min_price: 10,
      filter_max_price: 100,
      filter_in_stock: true,
      filter_on_sale: true,
      is_active: false,
    })
  })

  it('starts at display order 0 when there are no slides', async () => {
    fake.reset()
    const { slide } = await (await POST(req('POST', { title: 'First' }))).json()
    expect(slide.display_order).toBe(0)
  })
})

describe('PATCH /api/admin/hero-slides (reorder)', () => {
  it('400 when order is empty, missing or not an array', async () => {
    expect((await PATCH(req('PATCH', { order: [] }))).status).toBe(400)
    expect((await PATCH(badReq('PATCH'))).status).toBe(400)
    expect((await PATCH(req('PATCH', { order: 'nope' }))).status).toBe(400)
  })

  it('reorders the draft only', async () => {
    const res = await PATCH(req('PATCH', { order: [S2, S1] }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(fake.state.draft!.hero_slides.map(s => [s.id, s.display_order])).toEqual([
      [S2, 0],
      [S1, 1],
    ])
    expect(fake.state.live.hero_slides.map(s => s.id)).toEqual([S1, S2])
    expect(liveWrites()).toEqual([])
  })
})

describe('PATCH/DELETE /api/admin/hero-slides/[id]', () => {
  it('updates the draft slide and leaves the live one alone', async () => {
    const res = await PATCH_ONE(req('PATCH', { badgeText: 'Sale', filterInStock: true, ctaUrl: null }), paramsFor(S1))
    expect(res.status).toBe(200)
    expect((await res.json()).slide).toMatchObject({ id: S1, badge_text: 'Sale', filter_in_stock: true, cta_url: null })
    expect(draftSlide(S1)).toMatchObject({ badge_text: 'Sale', filter_in_stock: true })
    expect(fake.state.live.hero_slides[0]).toMatchObject({ badge_text: null, filter_in_stock: false })
    expect(liveWrites()).toEqual([])
  })

  it('400 when no known field is sent', async () => {
    expect((await PATCH_ONE(req('PATCH', { nope: 1 }), paramsFor(S1))).status).toBe(400)
  })

  it('404s a slide that is not in the draft and leaves no draft behind', async () => {
    const res = await PATCH_ONE(req('PATCH', { title: 'x' }), paramsFor(MISSING))
    expect(res.status).toBe(404)
    expect(fake.state.draft).toBeNull()
  })

  it('removes the slide from the draft and keeps it live', async () => {
    const res = await DELETE(req('DELETE'), paramsFor(S2))
    expect(res.status).toBe(200)
    expect(fake.state.draft!.hero_slides.map(s => s.id)).toEqual([S1])
    expect(fake.state.live.hero_slides.map(s => s.id)).toEqual([S1, S2])
    expect(liveWrites()).toEqual([])
  })
})

describe('POST /api/admin/hero-slides/[id]/image', () => {
  it('404s before uploading when the slide is not in the editable set', async () => {
    const res = await UPLOAD(uploadReq({ file: png() }), paramsFor(MISSING))
    expect(res.status).toBe(404)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('rejects an unsupported file type', async () => {
    const gif = new File(['gif'], 'a.gif', { type: 'image/gif' })
    expect((await UPLOAD(uploadReq({ file: gif }), paramsFor(S1))).status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('uploads to S3 and sets the desktop image on the draft slide', async () => {
    const res = await UPLOAD(uploadReq({ file: png() }), paramsFor(S1))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      url: 'https://cdn.example.com/gallery/new.png',
      field: 'image_url',
      blurhash: 'LEHV6nWB2yk8',
    })
    expect(draftSlide(S1)).toMatchObject({
      image_url: 'https://cdn.example.com/gallery/new.png',
      blurhash: 'LEHV6nWB2yk8',
    })
    expect(fake.state.live.hero_slides[0].image_url).toBeNull()
    expect(liveWrites()).toEqual([])
  })

  it('sets the mobile image fields when field=image_url_mobile', async () => {
    await UPLOAD(uploadReq({ file: png(), field: 'image_url_mobile' }), paramsFor(S2))
    expect(draftSlide(S2)).toMatchObject({
      image_url: null,
      image_url_mobile: 'https://cdn.example.com/gallery/new.png',
      blurhash_mobile: 'LEHV6nWB2yk8',
    })
  })
})

describe('POST /api/admin/hero-slides/[id]/generate-image', () => {
  it('stores the generated image on the draft slide', async () => {
    vi.stubEnv('REPLICATE_API_TOKEN', 'test-token')
    mockRun.mockResolvedValue(['https://replicate.example/out.png'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))))
    const res = await GENERATE(req('POST', { prompt: 'bolts and nuts on steel' }), paramsFor(S1))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://cdn.example.com/gallery/new.png')
    expect(draftSlide(S1)).toMatchObject({
      image_url: 'https://cdn.example.com/gallery/new.png',
      blurhash: 'LEHV6nWB2yk8',
    })
    expect(liveWrites()).toEqual([])
  })

  it('404s a slide that is not in the editable set', async () => {
    vi.stubEnv('REPLICATE_API_TOKEN', 'test-token')
    const res = await GENERATE(req('POST', { prompt: 'bolts and nuts on steel' }), paramsFor(MISSING))
    expect(res.status).toBe(404)
    expect(mockRun).not.toHaveBeenCalled()
  })
})
