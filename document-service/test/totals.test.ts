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
