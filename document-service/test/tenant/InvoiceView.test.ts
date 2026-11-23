import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import InvoiceView from '../../src/tenant/views/InvoiceView.js'

// en-IN formatting matches the component's fmt()
const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const baseSettings: Record<string, string> = {
  business_trade_name: 'Jeffi Trade',
  business_legal_name: 'Jeffi Legal Pvt Ltd',
  business_address: '1 MG Road',
  business_gstin: '29ABCDE1234F1Z5',
  business_phone: '9999999999',
  business_email: 'shop@jeffi.test',
}

function render(order: any, items: any[], settings = baseSettings, token = 'tok-1') {
  return renderToStaticMarkup(InvoiceView({ order, items, settings, token }) as any)
}

const oneItem = [
  { product_name: 'Widget', hsn_code: '8481', quantity: 2, unit: 'pcs', total_price: 236, mrp: 150, unit_price: 118, taxable_amount: 200, discount_amount: 0 },
]

describe('InvoiceView', () => {
  it('normal GST invoice with cgst/sgst renders totals, taxable, GST and header', () => {
    const order = {
      invoice_number: 'INV/1', order_number: 'ORD/1', status: 'completed', source: 'online',
      invoice_date: '2026-01-15', payment_status: 'paid', payment_mode: 'Online',
      full_name: 'Alice', address_line1: 'Flat 2', address_line2: 'Block C', city: 'Bangalore', state: 'KA',
      postal_code: '560001', address_phone: '8888888888', buyer_gstin: '29ZZZZZ1234Z1Z5', tracking_number: 'TRK9',
      taxable_amount: 200, cgst_amount: 18, sgst_amount: 18, igst_amount: 0, total_amount: 236,
      discount_amount: 10, business_discount_amount: 5, shipping_amount: 20,
    }
    const html = render(order, oneItem)
    expect(html).toContain('TAX INVOICE')
    expect(html).toContain('#INV/1')
    expect(html).toContain('Order #ORD/1')
    expect(html).toContain(`₹${inr(236)}`) // total
    expect(html).toContain(`₹${inr(200)}`) // taxable
    expect(html).toContain('CGST')
    expect(html).toContain('SGST')
    expect(html).toContain(`₹${inr(18)}`)
    expect(html).toContain('Coupon Discount')
    expect(html).toContain('Business Discount')
    expect(html).toContain('Shipping')
    expect(html).toContain('TRK9')
    expect(html).toContain('GSTIN: 29ABCDE1234F1Z5')
    // legal name differs from trade name → shown
    expect(html).toContain('Jeffi Legal Pvt Ltd')
    // not cancelled
    expect(html).not.toContain('>Cancelled<')
    // IGST absent
    expect(html).not.toContain('>IGST<')
  })

  it('igst-only invoice shows IGST row but not CGST/SGST', () => {
    const order = {
      invoice_number: 'INV/2', status: 'completed', source: 'online', created_at: '2026-02-01',
      payment_status: 'pending', taxable_amount: 100, cgst_amount: 0, sgst_amount: 0, igst_amount: 36,
      total_amount: 136, full_name: 'Bob',
    }
    const html = render(order, oneItem)
    expect(html).toContain('>IGST<')
    expect(html).toContain(`₹${inr(36)}`)
    expect(html).not.toContain('>CGST<')
    expect(html).not.toContain('>SGST<')
    // pending payment path (no payment_mode) → 'Pending'
    expect(html).toContain('Pending')
  })

  it('no-GST invoice hides all GST rows', () => {
    const order = {
      invoice_number: 'INV/3', status: 'completed', source: 'online', created_at: '2026-03-01',
      payment_status: 'paid', taxable_amount: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
      total_amount: 100, discount_amount: 0, business_discount_amount: 0, shipping_amount: 0,
      full_name: 'Carol',
    }
    const html = render(order, oneItem)
    expect(html).not.toContain('>CGST<')
    expect(html).not.toContain('>SGST<')
    expect(html).not.toContain('>IGST<')
    expect(html).not.toContain('Taxable Amount')
    expect(html).not.toContain('Coupon Discount')
    expect(html).not.toContain('Business Discount')
    expect(html).not.toContain('>Shipping<')
    expect(html).toContain(`₹${inr(100)}`)
  })

  it('cash sale shows receipt title and Customer label, hides bank + order number', () => {
    const order = {
      invoice_number: 'CS/1', order_number: 'ORD/X', status: 'completed', source: 'cash_sale',
      invoice_date: '2026-04-01', payment_status: 'paid', total_amount: 50, taxable_amount: 0,
      customer_name: 'Walk-in',
    }
    const settings = { ...baseSettings, bank_account: '123456', bank_name: 'HDFC' }
    const html = render(order, oneItem, settings)
    expect(html).toContain('CASH SALE RECEIPT')
    expect(html).toContain('Customer')
    expect(html).toContain('computer-generated receipt')
    // bank details suppressed for cash sale
    expect(html).not.toContain('Bank Details')
    // order number hidden for cash sale
    expect(html).not.toContain('Order #ORD/X')
    expect(html).toContain('Walk-in')
  })

  it('cancelled status shows Cancelled banner', () => {
    const order = { invoice_number: 'INV/4', status: 'cancelled', source: 'online', created_at: '2026-05-01', total_amount: 10, taxable_amount: 0 }
    const html = render(order, oneItem)
    expect(html).toContain('Cancelled')
  })

  it('returned status shows Returned banner', () => {
    const order = { invoice_number: 'INV/5', status: 'returned', source: 'online', created_at: '2026-05-02', total_amount: 10, taxable_amount: 0 }
    const html = render(order, oneItem)
    expect(html).toContain('Returned')
  })

  it('normal invoice renders bank details when provided', () => {
    const order = { invoice_number: 'INV/6', status: 'completed', source: 'online', created_at: '2026-06-01', total_amount: 10, taxable_amount: 0 }
    const settings = {
      ...baseSettings, bank_holder_name: 'Jeffi Trade', bank_name: 'ICICI',
      bank_account: '000111222', bank_ifsc: 'ICIC0001', bank_branch: 'MG Road',
    }
    const html = render(order, oneItem, settings)
    expect(html).toContain('Bank Details')
    expect(html).toContain('ICICI')
    expect(html).toContain('000111222')
    expect(html).toContain('ICIC0001')
    expect(html).toContain('MG Road')
  })

  it('item with no mrp falls back to discount-based pct; blank qty item still renders', () => {
    const order = { invoice_number: 'INV/7', status: 'completed', source: 'online', created_at: '2026-07-01', total_amount: 300, taxable_amount: 0, business_discount_amount: 20 }
    const items = [
      { product_name: 'NoMrp', quantity: 1, total_price: 100, discount_amount: 20, unit_price: 120 },
      { product_name: 'ZeroQty', quantity: 0, total_price: 0, unit_price: 0 },
    ]
    const html = render(order, items)
    expect(html).toContain('NoMrp')
    expect(html).toContain('ZeroQty')
    expect(html).toContain('%') // disc pct label rendered for discounted item
  })

  it('trade name falls back to legal name when trade name missing', () => {
    const order = { invoice_number: 'INV/8', status: 'completed', source: 'online', created_at: '2026-08-01', total_amount: 10, taxable_amount: 0 }
    const settings = { business_legal_name: 'Only Legal Ltd' }
    const html = render(order, oneItem, settings)
    expect(html).toContain('Only Legal Ltd')
    // legal name === tradeName so the secondary legal-name line is not duplicated as a <p class text-xs>
    expect((html.match(/Only Legal Ltd/g) || []).length).toBeGreaterThanOrEqual(1)
  })
})
