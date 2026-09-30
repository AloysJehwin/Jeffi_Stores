import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeHomepageDraftDb, sectionRow } from '../../../helpers/homepage-draft-db'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const fake = makeHomepageDraftDb()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => fake.db.query(...(a as [string, any[]])),
  queryOne: (...a: any[]) => fake.db.queryOne(...(a as [string])),
  queryMany: (...a: any[]) => fake.db.queryMany(...(a as [string])),
  withTransaction: (fn: any) => fake.db.withTransaction(fn),
}))

import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { revalidatePath } from 'next/cache'
import { GET, POST, PATCH } from '@/app/api/admin/homepage-sections/route'
import { PATCH as PATCH_ONE, DELETE } from '@/app/api/admin/homepage-sections/[id]/route'

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const admin = { adminId: ADMIN_ID, role: 'super_admin', scopes: [] }
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'aaaaaaaa-0000-4000-8000-000000000002'
const C = 'aaaaaaaa-0000-4000-8000-000000000003'
const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) })

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/homepage-sections', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

const liveWrites = () =>
  fake.state.statements.filter(s => /^(INSERT INTO|UPDATE|DELETE FROM) homepage_sections/.test(s))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  vi.mocked(hasScope).mockReturnValue(true)
  fake.reset({ sections: [sectionRow(A, 0), sectionRow(B, 1), sectionRow(C, 2)] })
})

describe('authorization', () => {
  it('401s every handler when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('GET'))).status).toBe(401)
    expect((await POST(req('POST', { type: 'hero' }))).status).toBe(401)
    expect((await PATCH(req('PATCH', { order: [A] }))).status).toBe(401)
    expect((await PATCH_ONE(req('PATCH', { title: 'x' }), paramsFor(A))).status).toBe(401)
    expect((await DELETE(req('DELETE'), paramsFor(A))).status).toBe(401)
  })

  it('403s without the settings:write scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req('GET'))).status).toBe(403)
    expect((await POST(req('POST', { type: 'hero' }))).status).toBe(403)
    expect((await PATCH(req('PATCH', { order: [A] }))).status).toBe(403)
    expect((await PATCH_ONE(req('PATCH', { title: 'x' }), paramsFor(A))).status).toBe(403)
    expect((await DELETE(req('DELETE'), paramsFor(A))).status).toBe(403)
    expect(fake.state.draft).toBeNull()
  })
})

describe('GET', () => {
  it('returns the live sections while there is no draft', async () => {
    const data = await (await GET(req('GET'))).json()
    expect(data.sections.map((s: any) => s.id)).toEqual([A, B, C])
  })

  it('returns the draft once one exists', async () => {
    await DELETE(req('DELETE'), paramsFor(B))
    const data = await (await GET(req('GET'))).json()
    expect(data.sections.map((s: any) => s.id)).toEqual([A, C])
  })
})

describe('POST', () => {
  it('rejects an unknown section type', async () => {
    const res = await POST(req('POST', { type: 'definitely_not_a_section' }))
    expect(res.status).toBe(400)
    expect(fake.state.draft).toBeNull()
  })

  it('appends to a draft copied from live, with table defaults, and leaves live alone', async () => {
    const res = await POST(req('POST', { type: 'product_row', config: { source: 'best_sellers', limit: 4 } }))
    expect(res.status).toBe(200)
    const { section } = await res.json()
    expect(section).toMatchObject({
      type: 'product_row',
      title: null,
      config: { source: 'best_sellers', limit: 4 },
      display_order: 3,
      is_active: true,
      starts_at: null,
      ends_at: null,
    })
    expect(section.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.state.draft!.sections.map(s => s.id)).toEqual([A, B, C, section.id])
    expect(fake.state.draft!.updated_by).toBe(ADMIN_ID)
    expect(fake.state.live.sections).toHaveLength(3)
    expect(liveWrites()).toEqual([])
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })

  it('rejects an end time before the start time without creating a draft', async () => {
    const res = await POST(
      req('POST', {
        type: 'promo_banner',
        startsAt: '2026-10-02T00:00:00Z',
        endsAt: '2026-10-01T00:00:00Z',
      })
    )
    expect(res.status).toBe(400)
    expect(fake.state.draft).toBeNull()
  })
})

describe('PATCH reorder', () => {
  it('requires a non-empty order array', async () => {
    expect((await PATCH(req('PATCH', { order: [] }))).status).toBe(400)
  })

  it('reorders the draft only', async () => {
    const res = await PATCH(req('PATCH', { order: [C, A, B] }))
    expect(res.status).toBe(200)
    expect(fake.state.draft!.sections.map(s => [s.id, s.display_order])).toEqual([
      [C, 0],
      [A, 1],
      [B, 2],
    ])
    expect(fake.state.live.sections.map(s => s.id)).toEqual([A, B, C])
    expect(liveWrites()).toEqual([])
  })
})

describe('PATCH one', () => {
  it('maps camelCase fields onto the draft row', async () => {
    const res = await PATCH_ONE(req('PATCH', { ctaLabel: 'Shop', isActive: false, config: { x: 1 } }), paramsFor(B))
    expect(res.status).toBe(200)
    const { section } = await res.json()
    expect(section).toMatchObject({ id: B, cta_label: 'Shop', is_active: false, config: { x: 1 } })
    expect(fake.state.draft!.sections.find(s => s.id === B)).toMatchObject({ cta_label: 'Shop', is_active: false })
    expect(fake.state.live.sections.find(s => s.id === B)).toMatchObject({ cta_label: null, is_active: true })
    expect(liveWrites()).toEqual([])
  })

  it('refuses a body with no known fields', async () => {
    const res = await PATCH_ONE(req('PATCH', {}), paramsFor(A))
    expect(res.status).toBe(400)
  })

  // Changing type would orphan the config, so it is not patchable by design.
  it('ignores an attempt to change the section type', async () => {
    const res = await PATCH_ONE(req('PATCH', { type: 'hero', title: 'x' }), paramsFor(A))
    expect(res.status).toBe(200)
    expect(fake.state.draft!.sections.find(s => s.id === A)).toMatchObject({ type: 'promo_banner', title: 'x' })
  })

  it('404s an id that is not in the draft and leaves no draft behind', async () => {
    const res = await PATCH_ONE(req('PATCH', { title: 'x' }), paramsFor('aaaaaaaa-0000-4000-8000-00000000ffff'))
    expect(res.status).toBe(404)
    expect(fake.state.draft).toBeNull()
  })

  it('404s a section that was already removed in the draft', async () => {
    await DELETE(req('DELETE'), paramsFor(A))
    const res = await PATCH_ONE(req('PATCH', { title: 'x' }), paramsFor(A))
    expect(res.status).toBe(404)
  })

  it('rejects an end time before the start time', async () => {
    const res = await PATCH_ONE(
      req('PATCH', { startsAt: '2026-10-02T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }),
      paramsFor(A)
    )
    expect(res.status).toBe(400)
    expect(fake.state.draft).toBeNull()
  })

  it('does not create a draft for a save that changes nothing', async () => {
    const res = await PATCH_ONE(req('PATCH', { title: 'Section ' + A }), paramsFor(A))
    expect(res.status).toBe(200)
    expect(fake.state.draft).toBeNull()
    expect(fake.state.rollbacks).toBe(1)
  })
})

describe('DELETE', () => {
  it('removes the section from the draft and keeps it live', async () => {
    const res = await DELETE(req('DELETE'), paramsFor(A))
    expect(res.status).toBe(200)
    expect(fake.state.draft!.sections.map(s => s.id)).toEqual([B, C])
    expect(fake.state.live.sections.map(s => s.id)).toEqual([A, B, C])
    expect(liveWrites()).toEqual([])
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })
})
