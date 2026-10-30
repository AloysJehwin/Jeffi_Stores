import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/auth/scopes'

const auth = vi.hoisted(() => ({ admin: { adminId: 'a1', role: 'manager', scopes: ['orders:read'] } }))
const client = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(async (_req: unknown, scope: string | null) =>
    scope && !hasScope(auth.admin.role, auth.admin.scopes, scope)
      ? NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      : auth.admin
  ),
}))
vi.mock('@/lib/shared/db', () => ({ withTransaction: vi.fn((fn: (c: unknown) => unknown) => fn(client)) }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenant: vi.fn(async () => null),
  runWithTenantContext: (_t: unknown, fn: () => unknown) => fn(),
}))
// Orders with a cap of 2 rows.
vi.mock('@/lib/filters/registry', async () => {
  const { ORDERS_ENTITY } = await vi.importActual<typeof import('@/lib/filters/entities/orders')>('@/lib/filters/entities/orders')
  const orders = { ...ORDERS_ENTITY, export: { ...ORDERS_ENTITY.export!, cap: 2 } }
  return { getEntity: (k: string) => (k === 'orders' ? orders : null) }
})

import { GET } from '@admin/app/api/(admin)/admin/filters/[entity]/export/route'
import { logAdminAudit } from '@/lib/shared/admin-audit'

const row = (n: string, customer: string) => ({ order_number: n, customer, total: '-12.50', __k0: '2026-10-01 10:00:00.123456+05:30', __k1: n })
const get = (qs: string) =>
  GET(new NextRequest(`http://localhost/api/admin/filters/orders/export?${qs}`), { params: Promise.resolve({ entity: 'orders' }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.admin = { adminId: 'a1', role: 'manager', scopes: ['orders:read'] }
  client.query.mockImplementation(async (sql: string) =>
    sql.includes('count(*)')
      ? { rows: [{ n: 3 }] }
      : sql.includes('o.order_number AS')
        ? { rows: [row('A1', 'Asha'), row('A2', '=HYPERLINK("x")')] }
        : { rows: [] }
  )
})

describe('GET /api/admin/filters/[entity]/export', () => {
  it("needs the list's export scope", async () => {
    auth.admin.scopes = ['products:read']
    expect((await get('status=shipped')).status).toBe(403)
    expect(client.query).not.toHaveBeenCalled()
  })

  it('streams the filtered rows up to the cap, escapes formulas, and audits the export', async () => {
    const res = await get('status=shipped&tab=list')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Row-Count')).toBe('2')
    expect(res.headers.get('X-Row-Capped')).toBe('true')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/)

    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer())
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0].startsWith('\uFEFFOrder no,Date,')).toBe(true)
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`)
    expect(lines[1]).toContain(',-12.50,')

    const batches = client.query.mock.calls.filter(([sql]) => String(sql).includes('o.order_number AS'))
    expect(batches).toHaveLength(1)
    expect(batches[0][0]).toContain('LIMIT 2')
    expect(batches[0][1]).toEqual(['shipped'])
    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: 'a1', action: 'export', entityType: 'orders', metadata: expect.objectContaining({ rows: 2, capped: true, completed: true }) })
    )
  })
})
