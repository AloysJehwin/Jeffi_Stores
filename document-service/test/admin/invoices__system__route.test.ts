import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({ withTransaction: vi.fn() }))
vi.mock('../../src/lib/invoice', () => ({
  createDraftInvoice: vi.fn(),
  assignInvoiceNumber: vi.fn(),
  generateOrderInvoice: vi.fn(),
}))

import { draft, number, generate } from '../../src/admin/invoices/system.js'
import { withTransaction } from '@jeffi/tenancy'
import { createDraftInvoice, assignInvoiceNumber, generateOrderInvoice } from '../../src/lib/invoice'

const ctx = (id = 'ord-1') => ({ params: Promise.resolve({ id }) })

beforeEach(() => vi.clearAllMocks())

describe('system routes (no admin session)', () => {
  it('draft creates a draft invoice and returns ok', async () => {
    const res = await draft({} as any, ctx('ord-9'))
    expect(createDraftInvoice).toHaveBeenCalledWith('ord-9')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('number assigns within a transaction and echoes the invoice number', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn('client'))
    vi.mocked(assignInvoiceNumber).mockResolvedValue('JS/24-25/001' as any)
    const res = await number({} as any, ctx('ord-2'))
    expect(assignInvoiceNumber).toHaveBeenCalledWith('client', 'ord-2')
    expect(await res.json()).toEqual({ ok: true, invoice_number: 'JS/24-25/001' })
  })

  it('generate returns 204 when there is no PDF', async () => {
    vi.mocked(generateOrderInvoice).mockResolvedValue(null as any)
    const res = await generate({} as any, ctx())
    expect(res.status).toBe(204)
  })

  it('generate returns the PDF with content-type and length', async () => {
    const pdf = Buffer.from('%PDF-xyz')
    vi.mocked(generateOrderInvoice).mockResolvedValue(pdf as any)
    const res = await generate({} as any, ctx('ord-3'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-length')).toBe(String(pdf.length))
    expect(Buffer.from(await res.arrayBuffer())).toEqual(pdf)
  })
})
