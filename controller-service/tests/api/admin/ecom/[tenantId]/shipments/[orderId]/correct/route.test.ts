import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), lookupTenantContextById: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const als = vi.hoisted(() => ({ runWithTenantContext: vi.fn(async (_c: unknown, fn: () => unknown) => fn()) }))
vi.mock('@/lib/tenancy/tenant-context', () => als)
const db = vi.hoisted(() => ({ queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/db', () => db)
const audit = vi.hoisted(() => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => audit)
const wallet = vi.hoisted(() => ({ settleDelhiveryCostToWallet: vi.fn(), correctWalletDebitForAwb: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => wallet)

import { POST } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/shipments/[orderId]/correct/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/t-1/shipments/o-1/correct', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ tenantId: 't-1', orderId: 'o-1' }),
  })
const good = { chargedAmount: 90, proofNote: 'invoice 12' }
const order = (o: Record<string, unknown> = {}) => ({ awb_number: 'AWB1', order_number: 'ORD-1', shipping_amount: '80', delhivery_billed_at: null, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', own_delhivery: false })
  reg.lookupTenantContextById.mockResolvedValue({ tenantId: 't-1' })
  db.queryOne.mockResolvedValue(order())
  db.query.mockResolvedValue({ rows: [] })
  wallet.settleDelhiveryCostToWallet.mockResolvedValue(true)
  wallet.correctWalletDebitForAwb.mockResolvedValue({ ok: true })
  audit.logAdminAudit.mockResolvedValue(undefined)
})

describe('POST /api/admin/ecom/[tenantId]/shipments/[orderId]/correct', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call(good)).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call(good)).status).toBe(403)
    expect(wallet.settleDelhiveryCostToWallet).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant and 409s for an own-Delhivery one', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call(good)).status).toBe(404)
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', own_delhivery: true })
    expect((await call(good)).status).toBe(409)
  })

  it.each([[{}], [{ chargedAmount: -1, proofNote: 'x' }], [{ chargedAmount: 5, proofNote: ' ' }]])('400s for a bad body %#', async body => {
    expect((await call(body)).status).toBe(400)
  })

  it('409s when the tenant has no active database', async () => {
    reg.lookupTenantContextById.mockResolvedValue(null)
    expect((await call(good)).status).toBe(409)
  })

  it('404s for an unknown order and 400s for one with no AWB', async () => {
    db.queryOne.mockResolvedValue(null)
    expect((await call(good)).status).toBe(404)
    db.queryOne.mockResolvedValue(order({ awb_number: null }))
    expect((await call(good)).status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('first set settles the cost to the wallet, records it, and audits', async () => {
    const res = await call(good)
    expect(await res.json()).toEqual({ ok: true, charged: 90, quoted: 80, difference: 10 })
    expect(wallet.settleDelhiveryCostToWallet).toHaveBeenCalledWith({ tenantId: 't-1', awb: 'AWB1', orderRef: 'ORD-1', amountInr: 90 })
    expect(wallet.correctWalletDebitForAwb).not.toHaveBeenCalled()
    expect(db.query.mock.calls[0][1]).toEqual(['o-1', 90, true])
    expect(audit.logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'o-1', metadata: expect.objectContaining({ correction: false, awb: 'AWB1' }) }))
  })

  it('a re-price posts a net wallet correction', async () => {
    db.queryOne.mockResolvedValue(order({ delhivery_billed_at: '2026-01-01' }))
    await call({ chargedAmount: 70, proofNote: 'weight dispute' })
    expect(wallet.correctWalletDebitForAwb).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1', awb: 'AWB1', newAmountInr: 70 }))
    expect(wallet.settleDelhiveryCostToWallet).not.toHaveBeenCalled()
  })

  it('does not stamp billed_at when the wallet movement fails', async () => {
    wallet.settleDelhiveryCostToWallet.mockResolvedValue(false)
    expect((await call(good)).status).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual(['o-1', 90, false])
  })

  it('moves no money for a zero charge on a first set', async () => {
    await call({ chargedAmount: 0, proofNote: 'free' })
    expect(wallet.settleDelhiveryCostToWallet).not.toHaveBeenCalled()
    expect(db.query).toHaveBeenCalled()
  })

  it('500s when the tenant-context work throws', async () => {
    db.query.mockRejectedValue(new Error('db'))
    const res = await call(good)
    expect(res.status).toBe(500)
    expect(audit.logAdminAudit).not.toHaveBeenCalled()
  })
})
