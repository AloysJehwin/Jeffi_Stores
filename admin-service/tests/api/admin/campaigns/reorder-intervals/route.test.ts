import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn() }))

import { GET, PUT } from '@admin/app/api/(admin)/admin/campaigns/reorder-intervals/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany } from '@/lib/shared/db'

const URL = 'http://localhost/api/admin/campaigns/reorder-intervals'
const CAT = '550e8400-e29b-41d4-a716-446655440001'
const put = (body: unknown) =>
  PUT(new NextRequest(URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

describe('/api/admin/campaigns/reorder-intervals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([
      { id: CAT, name: 'Screws', parent_id: null, parent_name: null, products: 275, reorder_interval_days: 60 },
    ] as any)
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)
  })

  it('needs campaign read access to list and write access to save', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await GET(new NextRequest(URL))).status).toBe(401)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(new NextRequest(URL))).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'campaigns:read')
    expect((await put({ intervals: [] })).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'campaigns:write')
    expect(query).not.toHaveBeenCalled()
  })

  it('lists categories with their interval and product count, skipping drafts', async () => {
    const body = await (await GET(new NextRequest(URL))).json()
    expect(body.categories).toEqual([
      { categoryId: CAT, name: 'Screws', parentId: null, parentName: null, products: 275, days: 60 },
    ])
    expect(String(vi.mocked(queryMany).mock.calls[0][0])).toContain('c.is_draft = FALSE')
  })

  it('saves days and clears a category back to "not a consumable"', async () => {
    const res = await put({ intervals: [{ categoryId: CAT, days: 45 }, { categoryId: CAT.replace(/1$/, '2'), days: null }] })
    expect(res.status).toBe(200)
    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(String(sql)).toContain('IS DISTINCT FROM t.days')
    expect(params).toEqual([[CAT, CAT.replace(/1$/, '2')], [45, null]])
  })

  it('rejects out-of-range days and bad ids without saving', async () => {
    expect((await put({ intervals: [{ categoryId: CAT, days: 0 }] })).status).toBe(400)
    expect((await put({ intervals: [{ categoryId: CAT, days: 366 }] })).status).toBe(400)
    expect((await put({ intervals: [{ categoryId: 'nope', days: 30 }] })).status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })
})
