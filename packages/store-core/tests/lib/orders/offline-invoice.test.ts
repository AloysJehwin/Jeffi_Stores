import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/customer-links', () => ({ invoiceUrlForOrder: vi.fn(async () => 'https://inv/1') }))
vi.mock('@/lib/catalog/product-label', () => ({ productLabel: (i: any) => i.product_name }))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn(), getBusinessValues: vi.fn(async () => ({ businessStateCode: '33' })) }))
vi.mock('@/lib/catalog/digital-guard', () => ({ findDigitalProductIds: vi.fn(async () => []) }))
vi.mock('@/lib/shared/db', () => ({ withTransaction: vi.fn() }))
vi.mock('@/lib/catalog/gst', () => ({ isInterState: vi.fn(() => false), round2: (n: number) => Math.round(n * 100) / 100 }))
vi.mock('@/lib/orders/issue-invoice', () => ({ issueOrderInvoice: vi.fn(async () => ({ invoiceNumber: 'JS/26-27/001' })) }))
vi.mock('@/lib/orders/inventory-deduct', () => ({
  deductOrderStock: vi.fn(async () => {}),
  checkLineStock: vi.fn(async () => []),
  resolveLineUnit: vi.fn(async () => ({ baseQty: 1 })),
  InsufficientStockError: class extends Error {
    code = 'OUT_OF_STOCK'
  },
}))
vi.mock('@/lib/documents/invoice-line-items', async () => {
  const { z } = await import('zod')
  return { invoiceLineSchema: z.any(), priceInvoiceLines: vi.fn(), formatShortfall: (s: any) => `${s.label} short` }
})
vi.mock('@/lib/email', () => ({ sendInvoiceFinalizedEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/validate', async () => {
  const { z } = await import('zod')
  return { zNonEmpty: z.string().min(1) }
})
vi.mock('@/lib/admin/draft-locks', () => ({ lockNewDraft: vi.fn(async () => {}) }))

import { assignmentsOf, createOfflineInvoice, OfflineInvoiceError } from '@/lib/orders/offline-invoice'
import { withTransaction } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { priceInvoiceLines } from '@/lib/documents/invoice-line-items'
import { checkLineStock, deductOrderStock, InsufficientStockError } from '@/lib/orders/inventory-deduct'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { lockNewDraft } from '@/lib/admin/draft-locks'

const data = { customerName: 'Ravi', customerEmail: 'r@x.in', items: [{ product_id: 'p1' }], paymentMode: 'upi_qr' } as any
const none = { batchAssignments: [], serialAssignments: [] }
const QR = { razorpayPaymentId: 'pay_1', razorpayQrId: 'qr_1', amountPaise: 11800, intentId: 'i1' }
const client = { query: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkLineStock).mockResolvedValue([])
  vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: true, inventoryValidationEnabled: true } as any)
  vi.mocked(priceInvoiceLines).mockReturnValue({
    lines: [{ product_id: 'p1', product_name: 'Widget', temp_id: 't1' }],
    subtotal: 100,
    taxAmount: 18,
    totalAmount: 118,
    totalTaxable: 100,
    totalCgst: 9,
    totalSgst: 9,
    totalIgst: 0,
  } as any)
  client.query.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr' }] }
    if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'o1', order_number: 'OFF-1' }] }
    if (sql.includes('INSERT INTO order_items')) return { rows: [{ id: 'oi1' }] }
    return { rows: [] }
  })
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
})

describe('createOfflineInvoice', () => {
  it('dry run: runs every check and write in a rolled-back transaction, and sends nothing', async () => {
    const r = await createOfflineInvoice(data, none, { dryRun: true })
    expect(r).toMatchObject({ orderId: 'o1', invoiceNumber: 'JS/26-27/001', saveAsDraft: false, totalAmount: 118 })
    expect(deductOrderStock).toHaveBeenCalled()
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
    expect(lockNewDraft).not.toHaveBeenCalled()
  })

  it('dry run reports a short-stock invoice as the draft it would be', async () => {
    vi.mocked(checkLineStock).mockResolvedValue([{ label: 'Widget' }] as any)
    const r = await createOfflineInvoice(data, none, { dryRun: true })
    expect(r).toMatchObject({ saveAsDraft: true, insufficientItems: ['Widget short'] })
  })

  it('paid by QR: records the payment in the same transaction, then emails as a paid creation does', async () => {
    const r = await createOfflineInvoice(data, none, { qrPayment: QR, actor: { adminId: 'a1' } })
    expect(r.orderId).toBe('o1')
    const calls = client.query.mock.calls.map(c => String(c[0]))
    expect(calls.some(s => s.includes("payment_mode = 'upi_qr'"))).toBe(true)
    const pay = client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO payments'))!
    expect(pay[1]).toEqual(['o1', 'pay_1', 118, expect.stringContaining('"payment_intent_id":"i1"')])
    expect(sendInvoiceFinalizedEmail).toHaveBeenCalledWith('r@x.in', 'Ravi', 'JS/26-27/001', 118, 'OFF-1', 'https://inv/1')
  })

  it('paid by QR: a short stock fails instead of saving a draft', async () => {
    vi.mocked(checkLineStock).mockResolvedValue([{ label: 'Widget' }] as any)
    await expect(createOfflineInvoice(data, none, { qrPayment: QR })).rejects.toBeInstanceOf(InsufficientStockError)
    expect(client.query.mock.calls.some(c => String(c[0]).includes('INSERT INTO orders'))).toBe(false)
  })

  it('paid by QR: a total that differs from the payment is refused before any write', async () => {
    await expect(createOfflineInvoice(data, none, { qrPayment: { ...QR, amountPaise: 100 } })).rejects.toMatchObject({ status: 409 })
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('refuses digital products', async () => {
    const { findDigitalProductIds } = await import('@/lib/catalog/digital-guard')
    vi.mocked(findDigitalProductIds).mockResolvedValueOnce(['p1'])
    await expect(createOfflineInvoice(data, none)).rejects.toBeInstanceOf(OfflineInvoiceError)
  })

  it('rethrows a real transaction failure', async () => {
    vi.mocked(withTransaction).mockRejectedValueOnce(new Error('db down'))
    await expect(createOfflineInvoice(data, none)).rejects.toThrow('db down')
  })
})

describe('assignmentsOf', () => {
  it('takes the body arrays and ignores anything else', () => {
    expect(assignmentsOf({ batch_assignments: [{ a: 1 }], serial_assignments: 'x' })).toEqual({ batchAssignments: [{ a: 1 }], serialAssignments: [] })
    expect(assignmentsOf(null)).toEqual(none)
  })
})
