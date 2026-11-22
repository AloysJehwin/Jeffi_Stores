import { describe, it, expect, vi } from 'vitest'

const gst = vi.hoisted(() => ({
  getFinancialYear: vi.fn(() => '2026-27'),
  generateInvoiceNumber: vi.fn((p: string, fy: string, seq: number) => `${p}/${fy}/${seq}`),
  getNextInvoiceSequence: vi.fn(async () => 42),
}))
vi.mock('@/lib/catalog/gst', () => gst)

import { issueOrderInvoice } from '@/lib/orders/issue-invoice'

function client(prefixRow?: { value: string } | undefined) {
  return { query: vi.fn(async () => ({ rows: prefixRow ? [prefixRow] : [] })) } as any
}

describe('issueOrderInvoice', () => {
  it('numbers and records the invoice with the configured prefix', async () => {
    const c = client({ value: 'ACME' })
    const at = new Date('2026-05-01T00:00:00.000Z')
    const r = await issueOrderInvoice(c, 'order-1', at)

    expect(r).toEqual({ invoiceNumber: 'ACME/2026-27/42', invoiceDate: at.toISOString(), financialYear: '2026-27', sequence: 42 })
    expect(gst.getFinancialYear).toHaveBeenCalledWith(at)
    expect(gst.getNextInvoiceSequence).toHaveBeenCalledWith(c, '2026-27')
    expect(gst.generateInvoiceNumber).toHaveBeenCalledWith('ACME', '2026-27', 42)

    // settings read, then UPDATE orders, then INSERT invoices
    expect(c.query).toHaveBeenNthCalledWith(1, "SELECT value FROM site_settings WHERE key = 'invoice_prefix'")
    const [updSql, updParams] = c.query.mock.calls[1]
    expect(updSql).toContain('UPDATE orders SET invoice_number')
    expect(updParams).toEqual(['ACME/2026-27/42', at.toISOString(), 'order-1'])
    const [insSql, insParams] = c.query.mock.calls[2]
    expect(insSql).toContain('INSERT INTO invoices')
    expect(insParams).toEqual(['order-1', 'ACME/2026-27/42', '2026-27', 42])
  })

  it('falls back to the JS prefix when no site setting', async () => {
    const c = client(undefined)
    const r = await issueOrderInvoice(c, 'order-2', new Date('2026-05-01T00:00:00.000Z'))
    expect(r.invoiceNumber).toBe('JS/2026-27/42')
    expect(gst.generateInvoiceNumber).toHaveBeenCalledWith('JS', '2026-27', 42)
  })

  it('defaults the issue date to now', async () => {
    const c = client({ value: 'JS' })
    const before = Date.now()
    const r = await issueOrderInvoice(c, 'order-3')
    const t = new Date(r.invoiceDate).getTime()
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(Date.now())
  })
})
