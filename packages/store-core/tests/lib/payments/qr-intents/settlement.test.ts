import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real booking chain (capture.routeCapturedPayment → route-settlement.recordCapturedPayment) behind a QR
// intent; only Razorpay Route, the control plane and the document creation are faked.
const cpQuery = vi.hoisted(() => vi.fn())
const route = vi.hoisted(() => ({
  fetchTransfersForPayment: vi.fn(),
  transferToLinkedAccount: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), resolveRequestTenant: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: cpQuery }) }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveRazorpayCreds: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: vi.fn(), getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/payments/razorpay-route', () => ({
  commissionPct: vi.fn(),
  fetchTransfer: vi.fn(),
  fetchLinkedSettlement: vi.fn(),
  fetchTransfersForSettlement: vi.fn(),
  reverseTransfer: vi.fn(),
  ...route,
}))
vi.mock('@/lib/payments/webhook-tenant', () => ({ isFlagship: (t: any) => !t?.tenantId || t.tenantId === '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/email', () => ({ sendOrderConfirmationEmail: vi.fn(), sendNewOrderNotification: vi.fn(), sendPaymentStatusUpdate: vi.fn() }))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: vi.fn() }))
vi.mock('@/lib/shared/marketing', () => ({ attributeConversion: vi.fn() }))
vi.mock('@/lib/orders/order-draft', () => ({ hashCartItems: vi.fn(), verifyDraftToken: vi.fn() }))
vi.mock('@/lib/orders/order-commit', () => ({
  loadActiveCart: vi.fn(),
  cartItemsForHash: vi.fn(),
  cartSubtotal: vi.fn(),
  cartTaxAmount: vi.fn(),
  validateCouponForUser: vi.fn(),
  commitOrder: vi.fn(),
}))
vi.mock('@/lib/shared/notify', () => ({ notifyAccessGranted: vi.fn() }))
vi.mock('@/lib/documents/invoice', () => ({ createDraftInvoice: vi.fn(), generateOrderInvoice: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn() }))
vi.mock('@/lib/orders/variant-change', () => ({ settleVariantChangePayment: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/shared/ai-feedback', () => ({ recordImplicitSignalsForProducts: vi.fn() }))
vi.mock('@/lib/google-ads/conversions/queue', () => ({ queueAdsConversion: vi.fn() }))
vi.mock('@/lib/payments/upi-qr', () => ({ cropRazorpayQr: vi.fn() }))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/catalog/brand', () => ({ currentBrandNameAsync: vi.fn(async () => 'Acme') }))
vi.mock('@/lib/payments/qr-intents/kinds', () => {
  const kind = () => ({ validate: vi.fn(), finalise: vi.fn(), existing: vi.fn(async () => null) })
  return { KINDS: { invoice: kind(), quotation_convert: kind(), invoice_draft_finalise: kind(), cash_sale: kind() }, resultLinks: vi.fn() }
})

import { finaliseQrIntent } from '@/lib/payments/qr-intents'
import { KINDS } from '@/lib/payments/qr-intents/kinds'
import { query, withTransaction } from '@/lib/shared/db'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'

const STORE = { tenantId: '44444444-4444-4444-8444-444444444444', slug: 'acme' }
let row: any
const client = {
  query: vi.fn(async (sql: string, p: any[] = []) => {
    if (sql.includes('FOR UPDATE')) return { rows: [{ ...row }] }
    if (sql.includes("status = 'finalised'")) return { rows: [(row = { ...row, status: 'finalised', result_ref: p[1] })] }
    return { rows: [{ ...row }] }
  }),
}
let ownFlag = false
const sqlsOf = () => cpQuery.mock.calls.map(c => String(c[0]))
const txnRow = (p: any[]) => ({
  id: 'txn_1',
  tenant_id: p[0],
  order_ref: p[1],
  gross_amount: p[2],
  tenant_share: p[2],
  platform_commission: 0,
  gateway_fee: 0,
  is_cod: false,
  gateway: p[3],
  gateway_txn_id: p[5],
  status: 'captured',
  payment_id: p[5],
  transfer_id: null,
  refunded_amount: 0,
  reversed_amount: 0,
})

beforeEach(() => {
  vi.clearAllMocks()
  ownFlag = false
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
  vi.mocked(resolveRazorpayCreds).mockImplementation(async () => ({ isOwn: ownFlag }) as any)
  cpQuery.mockImplementation(async (sql: string, p: any[] = []) => {
    if (sql.includes('SELECT own_razorpay FROM tenants')) return { rows: [{ own_razorpay: ownFlag }] }
    if (sql.includes('INSERT INTO tenant_transactions')) return { rows: [txnRow(p)] }
    if (sql.includes('razorpay_linked_account_id') && sql.includes('FROM tenants t'))
      return { rows: [{ razorpay_linked_account_id: 'acc_store', daily_payout: false, own_delhivery: false, status: 'active' }] }
    if (sql.includes('UPDATE tenant_transactions'))
      return { rows: [{ ...txnRow([STORE.tenantId, 'x', 118, 'razorpay_route', false, 'pay_1']), transfer_id: 'trf_1', tenant_share: 112, status: 'split' }] }
    return { rows: [] }
  })
  route.fetchTransfersForPayment.mockResolvedValue({ ok: true, transfers: [] })
  route.transferToLinkedAccount.mockResolvedValue({ transferId: 'trf_1', amount: 11200, platformCommissionPaise: 300, gatewayFeePaise: 300, transferFeePaise: 0 })
})

const paid = (kind: string) => {
  row = { id: 'i1', kind, status: 'paid', amount_paise: '11800', razorpay_payment_id: 'pay_1', razorpay_qr_id: 'qr_1', payment: null, actor: {} }
}

describe('QR intent settlement for a store', () => {
  it('a Route store’s QR invoice is transferred to its linked account like any store payment', async () => {
    paid('invoice')
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    await finaliseQrIntent('i1', { store: STORE })

    const ins = cpQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO tenant_transactions'))!
    expect(ins[1]).toEqual([STORE.tenantId, 'OFF-1', 118, 'razorpay_route', false, 'pay_1'])
    expect(route.transferToLinkedAccount).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      grossAmountPaise: 11800,
      linkedAccountId: 'acc_store',
      orderId: 'ord_1',
      tenantSlug: 'acme',
      dailyPayout: false,
    })
    expect(sqlsOf().some(s => s.includes('INSERT INTO settlement_ledger'))).toBe(true)
  })

  it('a QR cash sale settles by its sale number the same way', async () => {
    paid('cash_sale')
    vi.mocked(KINDS.cash_sale.finalise).mockResolvedValue({ id: 'sale_1', ref: 'CS-1', totalInr: 118 })
    await finaliseQrIntent('i1', { store: STORE })
    expect(route.transferToLinkedAccount).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay_1', orderId: 'sale_1', grossAmountPaise: 11800 }))
    expect(cpQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO tenant_transactions'))![1][1]).toBe('CS-1')
  })

  it('a store on its own Razorpay account keeps the money: recorded, no transfer', async () => {
    ownFlag = true
    paid('invoice')
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    await finaliseQrIntent('i1', { store: STORE })
    expect(cpQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO tenant_transactions'))![1][3]).toBe('razorpay_own')
    expect(route.transferToLinkedAccount).not.toHaveBeenCalled()
  })

  it('the platform’s own store books nothing', async () => {
    paid('invoice')
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    await finaliseQrIntent('i1', { store: null })
    expect(cpQuery).not.toHaveBeenCalled()
  })
})
