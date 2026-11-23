import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import QuotationView from '../../src/tenant/views/QuotationView.js'

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const baseSettings: Record<string, string> = {
  business_trade_name: 'Jeffi Trade',
  business_legal_name: 'Jeffi Legal Pvt Ltd',
  business_gstin: '29ABCDE1234F1Z5',
}

function render(qt: any, items: any[], settings = baseSettings, token = 'q-1') {
  return renderToStaticMarkup(QuotationView({ qt, items, settings, token }) as any)
}

describe('QuotationView', () => {
  it('GST quotation with aggregate columns renders subtotal, CGST/SGST, total, validity and discount col', () => {
    const qt = {
      quote_number: 'Q/1', quote_date: '2026-01-01', valid_until: '2026-02-01', status: 'sent',
      subtotal: 1000, cgst_amount: 90, sgst_amount: 90, total_amount: 1180,
      consignee_name: 'Acme', consignee_addr1: 'Addr 1', consignee_addr2: 'Addr 2',
      consignee_city: 'Pune', consignee_state: 'MH', consignee_pincode: '411001',
      consignee_gstin: '27AAAAA0000A1Z5', consignee_phone: '777', consignee_email: 'a@acme.test',
      notes: 'Pay in 30 days',
    }
    const items = [
      { description: 'Service A', hsn_code: '9983', quantity: 2, unit: 'hr', rate: 500, amount: 1180, gst_rate: 18, discount_pct: 10 },
    ]
    const html = render(qt, items)
    expect(html).toContain('QUOTATION')
    expect(html).toContain('#Q/1')
    expect(html).toContain('Valid until:')
    expect(html).toContain('Subtotal')
    expect(html).toContain(`₹${inr(1000)}`)
    expect(html).toContain('>CGST<')
    expect(html).toContain('>SGST<')
    expect(html).toContain(`₹${inr(90)}`)
    expect(html).toContain(`₹${inr(1180)}`) // total
    expect(html).toContain('Disc%') // discount column header (an item has discount_pct > 0)
    expect(html).toContain('10%')
    expect(html).toContain('Notes')
    expect(html).toContain('Pay in 30 days')
    expect(html).toContain('Acme')
    expect(html).toContain('27AAAAA0000A1Z5')
    expect(html).not.toContain('Draft')
  })

  it('no-GST quote (gst_rate 0, no aggregates) hides CGST/SGST and discount column', () => {
    const qt = { quote_number: 'Q/2', quote_date: '2026-03-01', status: 'sent' }
    const items = [
      { description: 'Flat item', quantity: 1, unit: 'pc', rate: 100, amount: 100, gst_rate: 0, discount_pct: 0 },
    ]
    const html = render(qt, items)
    expect(html).not.toContain('>CGST<')
    expect(html).not.toContain('>SGST<')
    expect(html).not.toContain('Disc%')
    expect(html).not.toContain('Valid until:')
    expect(html).not.toContain('Notes')
    // subtotal computed from items when aggregates NULL
    expect(html).toContain(`₹${inr(100)}`)
  })

  it('draft status shows Draft badge; computes GST from items when aggregates NULL', () => {
    const qt = { quote_number: 'Q/3', quote_date: '2026-04-01', status: 'draft', consignee_name: 'X' }
    const items = [
      { description: 'Taxed', quantity: 1, unit: 'pc', rate: 118, amount: 118, gst_rate: 18, discount_pct: 0 },
    ]
    const html = render(qt, items)
    expect(html).toContain('Draft')
    expect(html).toContain('>CGST<')
    expect(html).toContain('>SGST<')
    // taxable base = 118 / 1.18 = 100, cgst = 100*0.18/2 = 9
    expect(html).toContain(`₹${inr(9)}`)
  })

  it('shows discount total line when an item carries discount_pct', () => {
    const qt = { quote_number: 'Q/4', quote_date: '2026-05-01', status: 'sent', subtotal: 100, total_amount: 100 }
    const items = [
      { description: 'D', quantity: 2, unit: 'pc', rate: 100, amount: 100, gst_rate: 0, discount_pct: 10 },
    ]
    const html = render(qt, items)
    // discount line: rate*qty*(pct/100) = 100*2*0.1 = 20
    expect(html).toContain('Discount')
    expect(html).toContain(`₹${inr(20)}`)
  })

  it('renders Buyer block only when buyer differs and buyer_name present', () => {
    const qt = {
      quote_number: 'Q/5', quote_date: '2026-06-01', status: 'sent', consignee_name: 'Consignee Co',
      buyer_same: false, buyer_name: 'Buyer Co', buyer_addr1: 'B1', buyer_addr2: 'B2',
      buyer_city: 'Delhi', buyer_state: 'DL', buyer_pincode: '110001',
      buyer_gstin: '07BBBBB0000B1Z5', buyer_phone: '666', buyer_email: 'b@buyer.test',
    }
    const items = [{ description: 'I', quantity: 1, unit: 'pc', rate: 10, amount: 10, gst_rate: 0, discount_pct: 0 }]
    const html = render(qt, items)
    expect(html).toContain('Buyer')
    expect(html).toContain('Buyer Co')
    expect(html).toContain('07BBBBB0000B1Z5')
  })

  it('hides Buyer block when buyer_same is true', () => {
    const qt = { quote_number: 'Q/6', quote_date: '2026-07-01', status: 'sent', consignee_name: 'C', buyer_same: true, buyer_name: 'Buyer Co' }
    const items = [{ description: 'I', quantity: 1, unit: 'pc', rate: 10, amount: 10, gst_rate: 0, discount_pct: 0 }]
    const html = render(qt, items)
    expect(html).not.toContain('Buyer Co')
  })

  it('renders bank details and legal-name fallback for trade name', () => {
    const qt = { quote_number: 'Q/7', quote_date: '2026-08-01', status: 'sent', consignee_name: 'C' }
    const settings = { business_legal_name: 'Only Legal Ltd', bank_name: 'SBI', bank_account: '9988', bank_ifsc: 'SBIN0', bank_branch: 'Main', bank_holder_name: 'Holder' }
    const items = [{ description: 'I', quantity: 1, unit: 'pc', rate: 10, amount: 10, gst_rate: 0, discount_pct: 0 }]
    const html = render(qt, items, settings)
    expect(html).toContain('Only Legal Ltd')
    expect(html).toContain('Bank Details')
    expect(html).toContain('SBI')
    expect(html).toContain('9988')
  })
})
