import { describe, it, expect } from 'vitest'
import { generateReceiptPDF } from '../src/lib/receipt-pdf.js'
import type { ReceiptBusinessSettings, ReceiptOrder, ReceiptItem } from '../src/lib/receipt-pdf.js'

// pdfkit renders in-memory (no fs); call for real and assert the %PDF magic bytes.

const business: ReceiptBusinessSettings = {
  legalName: 'Jeffi Stores Pvt Ltd',
  tradeName: 'Jeffi Stores',
  address: 'Station Road, Raipur',
  phone: '+91 96853 54099',
  gstin: '22AAAAA0000A1Z5',
}

const baseOrder: ReceiptOrder = {
  invoice_number: 'CS/2025-26/001',
  invoice_date: '2025-06-01T10:00:00.000Z',
  payment_mode: 'Cash',
  customer_name: 'Alice Kumar',
  notes: 'Thanks',
  taxable_amount: 847.46,
  cgst_amount: 76.27,
  sgst_amount: 76.27,
  igst_amount: 0,
  is_igst: false,
  total_amount: 1000,
}

const item = (o: Partial<ReceiptItem> = {}): ReceiptItem => ({
  product_name: 'Widget A',
  quantity: 2,
  unit_price: 500,
  total_price: 1000,
  taxable_amount: 847.46,
  cgst_amount: 76.27,
  sgst_amount: 76.27,
  igst_amount: 0,
  gst_rate: 18,
  ...o,
})

const isPdf = (b: Buffer) => b.subarray(0, 4).toString() === '%PDF'

describe('generateReceiptPDF', () => {
  it('returns a %PDF buffer for a CGST/SGST receipt', async () => {
    const buf = await generateReceiptPDF(baseOrder, [item()], business)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(isPdf(buf)).toBe(true)
  }, 20_000)

  it('handles IGST order (igst_amount > 0)', async () => {
    const order = { ...baseOrder, is_igst: true, igst_amount: 152.54, cgst_amount: 0, sgst_amount: 0 }
    const buf = await generateReceiptPDF(order, [item({ igst_amount: 152.54, cgst_amount: 0, sgst_amount: 0 })], business)
    expect(isPdf(buf)).toBe(true)
  }, 20_000)

  it('handles item with discount_amount and buy_unit', async () => {
    const buf = await generateReceiptPDF(baseOrder, [item({ discount_amount: 50, buy_unit: 'kg', quantity: 1.5 })], business)
    expect(isPdf(buf)).toBe(true)
  }, 20_000)

  it('handles item with no discount and null buy_unit', async () => {
    const buf = await generateReceiptPDF(baseOrder, [item({ discount_amount: 0, buy_unit: null })], business)
    expect(isPdf(buf)).toBe(true)
  }, 20_000)

  it('omits phone/gstin header lines and customer when absent/walk-in', async () => {
    const bizMinimal: ReceiptBusinessSettings = { ...business, phone: '', gstin: '' }
    const order = { ...baseOrder, customer_name: 'walk-in customer', notes: undefined, payment_mode: '' }
    const buf = await generateReceiptPDF(order, [item()], bizMinimal)
    expect(isPdf(buf)).toBe(true)
  }, 20_000)

  it('falls back to legalName when tradeName is empty', async () => {
    const buf = await generateReceiptPDF(baseOrder, [item()], { ...business, tradeName: '' })
    expect(isPdf(buf)).toBe(true)
  }, 20_000)

  it('renders amount-in-words with lakh/thousand/paise path', async () => {
    const order = {
      ...baseOrder,
      total_amount: 123456.75,
      taxable_amount: 104624.36,
      cgst_amount: 9416.2,
      sgst_amount: 9416.2,
    }
    const buf = await generateReceiptPDF(order, [item({ total_price: 123456.75, unit_price: 61728.38 })], business)
    expect(isPdf(buf)).toBe(true)
  }, 20_000)

  it('handles crore amount and zero total (words branches)', async () => {
    const crore = await generateReceiptPDF({ ...baseOrder, total_amount: 23456789.5 }, [item()], business)
    expect(isPdf(crore)).toBe(true)
    const zero = await generateReceiptPDF(
      { ...baseOrder, total_amount: 0, taxable_amount: 0, cgst_amount: 0, sgst_amount: 0 },
      [item({ total_price: 0, taxable_amount: 0, cgst_amount: 0, sgst_amount: 0, unit_price: 0 })],
      business
    )
    expect(isPdf(zero)).toBe(true)
  }, 20_000)
})
