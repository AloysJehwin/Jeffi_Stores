import { describe, it, expect, vi, beforeEach } from 'vitest'

// One fake order row, so a second PO event sees the invoice the first one issued.
const s = vi.hoisted(() => ({ mo: { id: 'mo1', order_id: 'o1', status: 'packed' }, invoice: null as string | null, sql: [] as string[] }))
const client = {
  query: vi.fn(async (sql: string) => {
    s.sql.push(sql)
    if (sql.includes('FROM marketplace_orders')) return { rows: [s.mo] }
    if (sql.includes('SELECT invoice_number FROM orders')) return { rows: [{ invoice_number: s.invoice }] }
    return { rows: [] }
  }),
}
vi.mock('@/lib/shared/db', () => ({ withTransaction: (fn: (c: unknown) => unknown) => fn(client) }))
vi.mock('@/lib/orders/issue-invoice', () => ({
  issueOrderInvoice: vi.fn(async () => {
    s.invoice = 'INV-0042'
    return { invoiceNumber: 'INV-0042' }
  }),
}))

import { recordPurchaseOrder } from '@/lib/marketplace/purchase-order'
import { issueOrderInvoice } from '@/lib/orders/issue-invoice'

const po = { number: 'PO-42', date: '2026-11-07T00:00:00.000Z', amount: 980.5, buyerGstin: '27AABCR1718E1ZL', buyerName: 'Reliance Retail Ltd' }

beforeEach(() => {
  vi.clearAllMocks()
  s.mo = { id: 'mo1', order_id: 'o1', status: 'packed' }
  s.invoice = null
  s.sql = []
})

describe('recordPurchaseOrder', () => {
  it('issues the invoice to AJIO once, however many times the PO arrives', async () => {
    expect(await recordPurchaseOrder({ channel: 'ajio', externalOrderId: 'FN-555', po })).toEqual({ invoiceNumber: 'INV-0042', issued: true })
    expect(await recordPurchaseOrder({ channel: 'ajio', externalOrderId: 'FN-555', po })).toEqual({ invoiceNumber: 'INV-0042', issued: false })
    expect(issueOrderInvoice).toHaveBeenCalledTimes(1)
    expect(s.sql.some(q => q.includes('buyer_gstin'))).toBe(true)
  })

  it('stores the PO but issues nothing for a cancelled order', async () => {
    s.mo.status = 'cancelled'
    expect(await recordPurchaseOrder({ channel: 'ajio', externalOrderId: 'FN-555', po })).toBeNull()
    expect(s.sql.some(q => q.includes('po_number'))).toBe(true)
    expect(issueOrderInvoice).not.toHaveBeenCalled()
  })

  it('ignores Myntra and orders without a PO number', async () => {
    expect(await recordPurchaseOrder({ channel: 'myntra', externalOrderId: 'MR-1', po })).toBeNull()
    expect(await recordPurchaseOrder({ channel: 'ajio', externalOrderId: 'FN-1', po: null })).toBeNull()
    expect(client.query).not.toHaveBeenCalled()
  })
})
