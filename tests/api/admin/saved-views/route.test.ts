import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/auth/scopes'

const auth = vi.hoisted(() => ({ admin: { adminId: 'a1', role: 'manager', scopes: ['orders:read'] } }))
vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(async (_req: unknown, scope: string | null) =>
    scope && !hasScope(auth.admin.role, auth.admin.scopes, scope)
      ? NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      : auth.admin
  ),
}))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET, POST } from '@/app/api/(admin)/admin/saved-views/route'
import { PATCH, DELETE } from '@/app/api/(admin)/admin/saved-views/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const ID = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const ROW = { id: ID, page_key: 'orders', name: 'COD', query: 'payment_type=cod', is_shared: false, mine: true, owner_name: null, updated_at: '2026-10-26T00:00:00Z' }
const url = 'http://localhost/api/admin/saved-views'
const json = (method: string, path: string, body: unknown) =>
  new NextRequest(`${url}${path}`, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const ctx = { params: Promise.resolve({ id: ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  auth.admin = { adminId: 'a1', role: 'manager', scopes: ['orders:read'] }
  vi.mocked(queryMany).mockResolvedValue([ROW])
  vi.mocked(queryOne).mockResolvedValue(ROW)
})

describe('/api/admin/saved-views', () => {
  it('rejects a page that is not a registered list', async () => {
    expect((await GET(new NextRequest(`${url}?page=nope`))).status).toBe(400)
    expect((await POST(json('POST', '', { page: 'admins', name: 'x' }))).status).toBe(400)
    expect(requireAdminScope).not.toHaveBeenCalled()
  })

  it("needs the list's read scope", async () => {
    auth.admin.scopes = ['products:read']
    expect((await GET(new NextRequest(`${url}?page=orders`))).status).toBe(403)
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('lists own and shared views; sharing is offered only with the write scope', async () => {
    const res = await GET(new NextRequest(`${url}?page=orders`))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.views[0]).toMatchObject({ id: ID, name: 'COD', mine: true, isShared: false })
    expect(j.canShare).toBe(false)
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['a1', 'orders'])
  })

  it('stores the canonical query without tab or page, and sharing needs orders:write', async () => {
    const body = { page: 'orders', name: ' Paid ', query: 'tab=list&page=3&status=confirmed,shipped&date_from=2026-01-01&bogus=1' }
    expect((await POST(json('POST', '', { ...body, isShared: true }))).status).toBe(403)
    expect(queryOne).not.toHaveBeenCalled()

    expect((await POST(json('POST', '', body))).status).toBe(201)
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['a1', 'orders', 'Paid', 'status=confirmed%7Cshipped&from=2026-01-01', false])

    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect((await POST(json('POST', '', body))).status).toBe(409)
  })

  it("never updates or deletes another admin's view", async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await PATCH(json('PATCH', `/${ID}`, { name: 'Mine now' }), ctx)).status).toBe(404)
    expect((await DELETE(new NextRequest(`${url}/${ID}`, { method: 'DELETE' }), ctx)).status).toBe(404)
    for (const [sql, params] of vi.mocked(queryOne).mock.calls) {
      expect(sql).toContain('admin_id = $2::uuid')
      expect(params).toEqual([ID, 'a1'])
    }
  })

  it('shares an own view only with the write scope', async () => {
    expect((await PATCH(json('PATCH', `/${ID}`, { isShared: true }), ctx)).status).toBe(403)
    auth.admin.scopes = ['orders:write']
    vi.mocked(queryOne).mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, is_shared: true })
    const res = await PATCH(json('PATCH', `/${ID}`, { isShared: true }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).view.isShared).toBe(true)
  })
})
