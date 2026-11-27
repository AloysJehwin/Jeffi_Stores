import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/auth/scopes'

const auth = vi.hoisted(() => ({ admin: { adminId: 'a1', role: 'manager', scopes: ['orders:read'] } as any }))
const client = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(async (_req: unknown, scope: string | null) =>
    scope && !hasScope(auth.admin.role, auth.admin.scopes, scope) ? NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) : auth.admin
  ),
}))
vi.mock('@/lib/shared/db', () => ({ withTransaction: vi.fn((fn: (c: unknown) => unknown) => fn(client)), query: vi.fn(), queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), queryCount: vi.fn(async () => 0), getClient: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenant: vi.fn(async () => null),
  runWithTenantContext: (_t: unknown, fn: () => unknown) => fn(),
}))
vi.mock('@/lib/export/presets', () => ({
  listPresets: vi.fn(async () => ({ presets: [], last: null })),
  savePreset: vi.fn(async (_a: string, _k: string, name: string, options: unknown) => (name === 'full' ? null : { id: 'p1', name, options, updatedAt: '2026-11-27T00:00:00Z' })),
  deletePreset: vi.fn(async (_a: string, _k: string, id: string) => id === '00000000-0000-0000-0000-000000000001'),
}))
vi.mock('@/lib/export/branding', () => ({
  loadBrand: vi.fn(async () => ({ name: 'Store', legalName: '', gstin: '', address: '', phone: '', email: '', logo: null })),
  adminDisplayName: vi.fn(async () => 'Admin'),
}))

import { GET, POST, PUT, DELETE } from '@admin/app/api/(admin)/admin/export/[key]/route'
import { savePreset } from '@/lib/export/presets'

const params = (key: string) => ({ params: Promise.resolve({ key }) })
const req = (method: string, key: string, body?: unknown, qs = '') =>
  new NextRequest(`http://localhost/api/admin/export/${key}${qs}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } })

const options = { format: 'csv', scope: 'filtered', columns: ['order_number', 'date', 'total'], filters: {}, branding: { header: false } }

beforeEach(() => {
  vi.clearAllMocks()
  auth.admin = { adminId: 'a1', role: 'manager', scopes: ['orders:read'] }
  client.query.mockImplementation(async (sql: string) => {
    if (sql.includes('statement_timeout')) return { rows: [] }
    if (sql.includes('count(*)')) return { rows: [{ n: 2 }] }
    return { rows: [{ order_number: 'JS-1', date: '2026-11-01 10:00', total: '100.00', __k0: '2026-11-01', __k1: 'id1' }, { order_number: 'JS-2', date: '2026-11-02 11:00', total: '50.00', __k0: '2026-11-02', __k1: 'id2' }] }
  })
})

describe('/api/admin/export/[key]', () => {
  it('404s an unknown export and 403s without the list scope', async () => {
    expect((await GET(req('GET', 'nope'), params('nope'))).status).toBe(404)
    auth.admin = { adminId: 'a1', role: 'manager', scopes: ['products:read'] }
    expect((await GET(req('GET', 'orders'), params('orders'))).status).toBe(403)
  })

  it('returns the schema with defaults and include choices', async () => {
    const res = await GET(req('GET', 'orders', undefined, '?q=status%3Dpending'), params('orders'))
    expect(res.status).toBe(200)
    const s = await res.json()
    expect(s.key).toBe('orders')
    expect(s.formats).toEqual(['csv', 'xlsx', 'pdf', 'pptx'])
    expect(s.scopes).toContain('selected')
    expect(s.defaults.columns[0]).toBe('order_number')
    expect(s.filters.map((f: any) => f.key)).toContain('source')
  })

  it('counts and streams the filtered rows with a totals row', async () => {
    const count = await POST(req('POST', 'orders', { action: 'count', options, context: { query: 'status=pending' } }), params('orders'))
    expect(await count.json()).toEqual({ count: 2 })
    const res = await POST(req('POST', 'orders', { options, context: { query: 'status=pending' } }), params('orders'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"/)
    const text = await res.text()
    expect(text).toContain('JS-1,2026-11-01 10:00,100.00')
    expect(text).toContain('Total,,150.00')
    const sql = client.query.mock.calls.map(c => c[0]).find((s: string) => s.includes('o.order_number AS'))
    expect(sql).toContain("o.status")
  })

  it('rejects a bad body and an empty selection', async () => {
    expect((await POST(req('POST', 'orders', { nope: 1 }), params('orders'))).status).toBe(400)
    const res = await POST(req('POST', 'orders', { options: { ...options, scope: 'selected' }, context: { selectedIds: [] } }), params('orders'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Select some rows/)
  })

  it('saves and deletes named presets', async () => {
    expect((await PUT(req('PUT', 'orders', { name: '  ' }), params('orders'))).status).toBe(400)
    const ok = await PUT(req('PUT', 'orders', { name: 'Monthly', options }), params('orders'))
    expect((await ok.json()).preset.name).toBe('Monthly')
    expect(savePreset).toHaveBeenCalledWith('a1', 'orders', 'Monthly', expect.objectContaining({ format: 'csv' }))
    expect((await PUT(req('PUT', 'orders', { name: 'full', options }), params('orders'))).status).toBe(409)
    expect((await DELETE(req('DELETE', 'orders', undefined, '?id=bad'), params('orders'))).status).toBe(400)
    expect((await DELETE(req('DELETE', 'orders', undefined, '?id=00000000-0000-0000-0000-000000000002'), params('orders'))).status).toBe(404)
    expect((await DELETE(req('DELETE', 'orders', undefined, '?id=00000000-0000-0000-0000-000000000001'), params('orders'))).status).toBe(200)
  })
})
