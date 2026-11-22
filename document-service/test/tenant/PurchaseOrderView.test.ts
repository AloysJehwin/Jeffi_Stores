import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PurchaseOrderView from '../../src/tenant/views/PurchaseOrderView.js'

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const baseSettings: Record<string, string> = {
  business_trade_name: 'Jeffi Trade',
  business_legal_name: 'Jeffi Legal Pvt Ltd',
}

function render(po: any, items: any[], grns: any[] = [], settings = baseSettings, token = 'po-1') {
  return renderToStaticMarkup(PurchaseOrderView({ po, items, settings, token, grns }) as any)
}

describe('PurchaseOrderView', () => {
  it('GST PO with exclusive tax renders supplier block, GST line, totals and expected date', () => {
    const po = {
      po_number: 'PO/1', order_date: '2026-01-01', expected_date: '2026-01-15', status: 'sent',
      supplier_name: 'Supplier Co', contact_name: 'Sam', supplier_address: 'Industrial Area',
      supplier_gstin: '29SUPPL0000S1Z5', supplier_email: 's@supplier.test',
      subtotal: 1000, tax_amount: 180, total_amount: 1180, notes: 'Deliver to dock 3',
    }
    const items = [
      {
        product_name: 'Steel', variant_name: 'Grade A', sku: 'STL-A', quantity: 100,
        purchase_unit_factor: 10, purchase_unit: 'box', base_unit: 'kg',
        sell_unit_factor: 1, sell_unit: 'kg', unit_cost: 10, total_cost: 1000, tax_rate: 18, gst_inclusive: false,
      },
    ]
    const html = render(po, items)
    expect(html).toContain('PURCHASE ORDER')
    expect(html).toContain('#PO/1')
    expect(html).toContain('Expected by:')
    expect(html).toContain('Supplier Co')
    expect(html).toContain('Attn: Sam')
    expect(html).toContain('29SUPPL0000S1Z5')
    expect(html).toContain('Steel / Grade A') // variant label
    expect(html).toContain('STL-A')
    expect(html).toContain('GST @ 18%')
    expect(html).toContain(`₹${inr(180)}`) // exclusive gst = 1000*0.18
    expect(html).toContain(`₹${inr(1000)}`) // subtotal
    expect(html).toContain(`₹${inr(1180)}`) // total
    expect(html).toContain('Notes')
    expect(html).toContain('Deliver to dock 3')
    // purchaseFactor > 1 → conversion note; box count = 100/10 = 10
    expect(html).toContain('1 box =')
    expect(html).not.toContain('Draft')
    expect(html).not.toContain('Receipt History')
  })

  it('gst_inclusive item computes taxable from gross and shows incl. labels', () => {
    const po = { po_number: 'PO/2', order_date: '2026-02-01', status: 'draft', supplier_name: 'Inc Co' }
    const items = [
      {
        product_name: 'Plain', quantity: 10, unit_cost: 11.8, total_cost: 118,
        tax_rate: 18, gst_inclusive: true, base_unit: 'unit', purchase_unit_factor: 1,
      },
    ]
    const html = render(po, items)
    expect(html).toContain('Draft')
    expect(html).toContain('incl. GST')
    expect(html).toContain('(incl.)')
    expect(html).toContain('GST @ 18%')
    // inclusive gst = 118 - 118/1.18 = 18
    expect(html).toContain(`₹${inr(18)}`)
    // no variant → just product name
    expect(html).toContain('Plain')
  })

  it('no-GST PO hides GST lines and expected date; total falls back to subtotal', () => {
    const po = { po_number: 'PO/3', order_date: '2026-03-01', status: 'sent', supplier_name: 'NoTax Co' }
    const items = [
      { product_name: 'Free', quantity: 5, unit_cost: 20, total_cost: 100, tax_rate: 0, gst_inclusive: false, base_unit: 'unit', purchase_unit_factor: 1 },
    ]
    const html = render(po, items)
    expect(html).not.toContain('GST @')
    expect(html).not.toContain('Expected by:')
    expect(html).toContain(`₹${inr(100)}`) // subtotal == total fallback
    expect(html).not.toContain('Notes')
    expect(html).not.toContain('incl. GST')
  })

  it('renders Receipt History when grns present, matching line items and cost/pu', () => {
    const po = { po_number: 'PO/4', order_date: '2026-04-01', status: 'sent', supplier_name: 'Sup', subtotal: 100, total_amount: 118 }
    const items = [
      { id: 7, product_name: 'Bolt', variant_name: 'M8', quantity: 50, unit_cost: 2, total_cost: 100, tax_rate: 18, gst_inclusive: false, purchase_unit: 'box', purchase_unit_factor: 10, base_unit: 'pc' },
    ]
    const grns = [
      {
        id: 'g1', grn_number: 'GRN/1', received_date: '2026-04-05', notes: 'partial',
        grn_items: [
          { po_item_id: 7, quantity_received: 20, purchase_unit_factor: 10, unit_cost: 2, tax_rate: 18 },
          { po_item_id: 999, quantity_received: 5 }, // unmatched → "Item #N"
        ],
      },
    ]
    const html = render(po, items, grns)
    expect(html).toContain('Receipt History')
    expect(html).toContain('GRN/1')
    expect(html).toContain('partial')
    expect(html).toContain('Bolt / M8') // matched product via productLabel
    expect(html).toContain('Item #') // unmatched fallback
    // recv in purchase units = 20/10 = 2 box; cost/pu = 2*10*1.18 = 23.60
    expect(html).toContain(`₹${inr(23.6)}`)
  })

  it('total_cost absent → lineTotal from qty*unit_cost; falls back to base_unit label', () => {
    const po = { po_number: 'PO/5', order_date: '2026-05-01', status: 'sent', supplier_name: 'Sup' }
    const items = [
      { product_name: 'Calc', quantity: 4, unit_cost: 25, tax_rate: 0, gst_inclusive: false, base_unit: 'unit' },
    ]
    const html = render(po, items)
    expect(html).toContain(`₹${inr(100)}`) // 4*25
  })

  it('renders bank details and legal-name fallback for trade name', () => {
    const po = { po_number: 'PO/6', order_date: '2026-06-01', status: 'sent', supplier_name: 'Sup' }
    const settings = { business_legal_name: 'Only Legal Ltd', bank_name: 'Axis', bank_account: '4455', bank_ifsc: 'UTIB0', bank_branch: 'HQ', bank_holder_name: 'Holder' }
    const items = [{ product_name: 'X', quantity: 1, unit_cost: 10, total_cost: 10, tax_rate: 0, gst_inclusive: false, base_unit: 'unit' }]
    const html = render(po, items, [], settings)
    expect(html).toContain('Only Legal Ltd')
    expect(html).toContain('Bank Details')
    expect(html).toContain('Axis')
    expect(html).toContain('4455')
  })
})
