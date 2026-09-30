import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeHomepageDraftDb, sectionRow, slideRow } from '../../../helpers/homepage-draft-db'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn().mockResolvedValue(undefined) }))

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
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { GET, DELETE } from '@/app/api/(admin)/admin/homepage-draft/route'
import { POST as PUBLISH } from '@/app/api/(admin)/admin/homepage-draft/publish/route'

const ADMIN_ID = '33333333-3333-4333-8333-333333333333'
const admin = { adminId: ADMIN_ID, role: 'super_admin', scopes: [] }
const A = 'cccccccc-0000-4000-8000-000000000001'
const B = 'cccccccc-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const N = 'cccccccc-0000-4000-8000-000000000004'
const S1 = 'dddddddd-0000-4000-8000-000000000001'
const S2 = 'dddddddd-0000-4000-8000-000000000002'

const req = (method: string) => new NextRequest('http://localhost/api/admin/homepage-draft', { method })

// B removed, C edited and moved first, N added; slide S1 gets a new image.
function seedDraft() {
  fake.state.draft = {
    sections: [
      sectionRow(C, 0, { title: 'Edited' }),
      sectionRow(A, 1),
      sectionRow(N, 2, { type: 'benefits', created_at: '2026-09-25T00:00:00.000Z' }),
    ],
    hero_slides: [slideRow(S1, 0, { image_url: 'https://cdn.example.com/new.png' }), slideRow(S2, 1)],
    updated_by: ADMIN_ID,
    updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  }
  fake.state.adminNames[ADMIN_ID] = 'Aloys Jehwin'
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  vi.mocked(hasScope).mockReturnValue(true)
  fake.reset({
    sections: [sectionRow(A, 0), sectionRow(B, 1), sectionRow(C, 2)],
    heroSlides: [slideRow(S1, 0), slideRow(S2, 1)],
  })
})

describe('authorization', () => {
  it('401s every handler when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('GET'))).status).toBe(401)
    expect((await DELETE(req('DELETE'))).status).toBe(401)
    expect((await PUBLISH(req('POST'))).status).toBe(401)
  })

  it('403s without the settings:write scope', async () => {
    seedDraft()
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req('GET'))).status).toBe(403)
    expect((await DELETE(req('DELETE'))).status).toBe(403)
    expect((await PUBLISH(req('POST'))).status).toBe(403)
    expect(fake.state.draft).not.toBeNull()
  })
})

describe('GET /api/admin/homepage-draft', () => {
  it('reports nothing pending when there is no draft', async () => {
    expect(await (await GET(req('GET'))).json()).toEqual({
      hasDraft: false,
      updatedAt: null,
      updatedBy: null,
      sections: { added: 0, removed: 0, edited: 0, reordered: false },
      slides: { added: 0, removed: 0, edited: 0, reordered: false },
    })
  })

  it('summarises the draft against live', async () => {
    seedDraft()
    const data = await (await GET(req('GET'))).json()
    expect(data).toMatchObject({
      hasDraft: true,
      updatedBy: 'Aloys Jehwin',
      sections: { added: 1, removed: 1, edited: 1, reordered: true },
      slides: { added: 0, removed: 0, edited: 1, reordered: false },
    })
    expect(data.updatedAt).toBe(fake.state.draft!.updated_at)
  })
})

describe('DELETE /api/admin/homepage-draft', () => {
  it('discards the draft and records it in the audit log', async () => {
    seedDraft()
    const res = await DELETE(req('DELETE'))
    expect(await res.json()).toEqual({ success: true, discarded: true })
    expect(fake.state.draft).toBeNull()
    expect(fake.state.live.sections.map(s => s.id)).toEqual([A, B, C])
    expect(vi.mocked(logAdminAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: ADMIN_ID,
        action: 'delete',
        entityType: 'homepage',
      })
    )
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })

  it('is a no-op without a draft', async () => {
    expect(await (await DELETE(req('DELETE'))).json()).toEqual({ success: true, discarded: false })
    expect(vi.mocked(logAdminAudit)).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/homepage-draft/publish', () => {
  it('409s when there is no draft', async () => {
    const res = await PUBLISH(req('POST'))
    expect(res.status).toBe(409)
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })

  it('copies the draft onto live, deletes it and revalidates the homepage', async () => {
    seedDraft()
    const res = await PUBLISH(req('POST'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      published: {
        sections: { inserted: 1, updated: 2, deleted: 1 },
        heroSlides: { inserted: 0, updated: 1, deleted: 0 },
      },
    })
    expect(fake.state.draft).toBeNull()
    expect(fake.state.live.sections.map(s => s.id).sort()).toEqual([A, C, N].sort())
    expect(fake.state.live.sections.find(s => s.id === C)).toMatchObject({ title: 'Edited', display_order: 0 })
    expect(fake.state.live.hero_slides[0].image_url).toBe('https://cdn.example.com/new.png')
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/')
    expect(vi.mocked(logAdminAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: ADMIN_ID,
        action: 'update',
        entityType: 'homepage',
      })
    )
  })

  it('leaves live and the draft untouched when the publish fails', async () => {
    seedDraft()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = fake.db.withTransaction
    fake.db.withTransaction = (fn: any) =>
      original((client: any) =>
        fn({
          query: async (sql: string, params?: any[]) => {
            if (sql.startsWith('INSERT INTO hero_slides'))
              throw Object.assign(new Error('value too long'), { code: '22001' })
            return client.query(sql, params)
          },
        })
      )
    const res = await PUBLISH(req('POST'))
    fake.db.withTransaction = original
    expect(res.status).toBe(500)
    expect(fake.state.live.sections.map(s => s.id)).toEqual([A, B, C])
    expect(fake.state.draft).not.toBeNull()
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })
})
