import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), lookupTenantContextById: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const als = vi.hoisted(() => ({ runWithTenantContext: vi.fn(async (_c: unknown, fn: () => unknown) => fn()) }))
vi.mock('@/lib/tenancy/tenant-context', () => als)
const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/shared/db', () => db)
const audit = vi.hoisted(() => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => audit)
const wallet = vi.hoisted(() => ({ reconcileDelhiveryBilling: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => wallet)

import { POST } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/wallet/reconcile-billing/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/t-1/wallet/reconcile-billing', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ tenantId: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme' })
  reg.lookupTenantContextById.mockResolvedValue({ tenantId: 't-1' })
  db.query.mockResolvedValue({ rows: [] })
  wallet.reconcileDelhiveryBilling.mockResolvedValue([
    { awb: 'A1', outcome: 'adjusted' },
    { awb: 'A2', outcome: 'unchanged' },
  ])
  audit.logAdminAudit.mockResolvedValue(undefined)
})

describe('POST /api/admin/ecom/[tenantId]/wallet/reconcile-billing', () => {
  it('401s, 403s and 404s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({})).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({})).status).toBe(403)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
    reg.getTenant.mockResolvedValue(null)
    expect((await call({})).status).toBe(404)
    expect(wallet.reconcileDelhiveryBilling).not.toHaveBeenCalled()
  })

  it.each([
    [{ rows: [{ awb: 'A', billedAmount: 1 }] }],
    [{ period: '2026-8', rows: [{ awb: 'A', billedAmount: 1 }] }],
    [{ period: '2026-08', rows: [] }],
    [{ period: '2026-08', rows: [{ awb: '', billedAmount: 1 }, { awb: 'A', billedAmount: -3 }, { awb: 'B', billedAmount: 'x' }] }],
    ['not json'],
  ])('400s for a bad body %#', async body => {
    expect((await call(body)).status).toBe(400)
    expect(wallet.reconcileDelhiveryBilling).not.toHaveBeenCalled()
  })

  it('reconciles valid rows, mirrors adjusted ones onto orders, and audits', async () => {
    const res = await call({ period: '2026-08', rows: [{ awb: 'A1', billedAmount: 120 }, { awb: 'A2', billedAmount: 80 }, { awb: '', billedAmount: 1 }] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, period: '2026-08', summary: { adjusted: 1, unchanged: 1 } })
    expect(wallet.reconcileDelhiveryBilling).toHaveBeenCalledWith(
      [{ awb: 'A1', billedAmount: 120 }, { awb: 'A2', billedAmount: 80 }],
      't-1',
      '2026-08'
    )
    expect(db.query).toHaveBeenCalledTimes(1)
    expect(db.query.mock.calls[0][1]).toEqual(['A1', 120])
    expect(audit.logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ entityId: 't-1', metadata: expect.objectContaining({ period: '2026-08' }) }))
  })

  it('skips the order mirror when the tenant has no database context', async () => {
    reg.lookupTenantContextById.mockResolvedValue(null)
    expect((await call({ period: '2026-08', rows: [{ awb: 'A1', billedAmount: 1 }] })).status).toBe(200)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('still answers when the order mirror or audit fail', async () => {
    db.query.mockRejectedValue(new Error('db'))
    audit.logAdminAudit.mockRejectedValue(new Error('db'))
    expect((await call({ period: '2026-08', rows: [{ awb: 'A1', billedAmount: 1 }] })).status).toBe(200)
  })
})
