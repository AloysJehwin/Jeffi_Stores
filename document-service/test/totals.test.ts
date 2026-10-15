import { describe, it, expect } from 'vitest'
import { computeTotals } from '../src/totals.js'

const base = { template: 'classic', seller: { name: 'S', state: 'Tamil Nadu' }, prices_include_gst: true, currency: 'INR' as const }
describe('computeTotals', () => {
  it('splits CGST/SGST intra-state on inclusive prices', () => {
    const t = computeTotals({ ...base, buyer: { name: 'B', state: 'Tamil Nadu' }, items: [{ description: 'x', quantity: 1, unit_price: 1180, gst_rate: 18, discount: 0 }] })
    expect(t.taxable).toBe(1000); expect(t.cgst).toBe(90); expect(t.sgst).toBe(90); expect(t.igst).toBe(0); expect(t.total).toBe(1180)
  })
  it('uses IGST inter-state and exclusive pricing', () => {
    const t = computeTotals({ ...base, prices_include_gst: false, buyer: { name: 'B', state: 'Karnataka' }, items: [{ description: 'x', quantity: 2, unit_price: 500, gst_rate: 12, discount: 0 }] })
    expect(t.is_igst).toBe(true); expect(t.igst).toBe(120); expect(t.total).toBe(1120)
  })
})

describe('computeTotals — discounts, charges, round off, paid', () => {
  const buyer = { name: 'B', state: 'Tamil Nadu' }
  const item = (o: object = {}) => ({ description: 'x', quantity: 2, unit_price: 500, gst_rate: 18, discount: 0, ...o })
  it('applies line discount_pct and amount', () => {
    const t = computeTotals({ ...base, prices_include_gst: false, buyer, items: [item({ discount_pct: 10 }), item({ discount: 100 })] })
    expect(t.subtotal).toBe(2000); expect(t.line_discount).toBe(200); expect(t.taxable).toBe(1800); expect(t.total).toBe(2124)
    expect(t.lines[0].discount_pct).toBe(10); expect(t.lines[1].discount_pct).toBe(10)
  })
  it('spreads a document discount over the lines before GST', () => {
    const t = computeTotals({ ...base, prices_include_gst: false, buyer, items: [item(), item({ gst_rate: 5 })], discount: { percent: 10 } })
    expect(t.doc_discount).toBe(200); expect(t.doc_discount_label).toBe('Discount (10%)')
    expect(t.lines.map(l => l.taxable)).toEqual([900, 900]); expect(t.total).toBe(round(900 * 1.18 + 900 * 1.05))
  })
  it('caps a fixed document discount at the net amount', () => {
    const t = computeTotals({ ...base, buyer, items: [item()], discount: { amount: 5000, label: 'Promo' } })
    expect(t.doc_discount).toBe(1000); expect(t.total).toBe(0); expect(t.doc_discount_label).toBe('Promo')
  })
  it('taxes charges at their own rate and rounds off', () => {
    const t = computeTotals({ ...base, prices_include_gst: false, buyer, items: [item({ unit_price: 333.33, quantity: 1 })], charges: [{ label: 'Shipping', amount: 50, gst_rate: 18 }], round_off: true })
    expect(t.charges[0]).toMatchObject({ taxable: 50, tax: 9, total: 59 })
    expect(t.cgst + t.sgst).toBeCloseTo(60 + 9, 1)
    expect(Number.isInteger(t.total)).toBe(true); expect(t.round_off).toBe(round(t.total - (393.33 + 59)))
  })
  it('shows the balance due after an amount paid', () => {
    const t = computeTotals({ ...base, buyer, items: [item()], amount_paid: 400 })
    expect(t.amount_paid).toBe(400); expect(t.balance_due).toBe(600)
  })
})
const round = (n: number) => Math.round(n * 100) / 100
