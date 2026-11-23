import { describe, it, expect } from 'vitest'
import { renderDocument } from '../src/designs/index.js'
import { sampleRequest } from '../src/designs/sample.js'
import { computeTotals } from '../src/totals.js'
import type { RenderDocumentRequest } from '@jeffi/api-contracts'

const TYPES = ['invoice', 'quotation', 'receipt', 'packing_slip', 'label', 'purchase_order'] as const

const render = (key: string, type: typeof TYPES[number], req: RenderDocumentRequest) =>
  renderDocument(key, type, req, computeTotals(req), 'DOC/1', 'https://x.test/d/abc', { accent: '#112233', font: 'system' })

const isPdf = (b: Buffer) => b.subarray(0, 4).toString() === '%PDF'

describe('compact family (A5 sheet)', () => {
  it('renders the compact A5 design for every type', async () => {
    for (const type of TYPES) {
      const pdf = await render('compact', type, sampleRequest(type))
      expect(isPdf(pdf), `compact/${type}`).toBe(true)
    }
  }, 60_000)

  it('renders intra-state (CGST/SGST), discounts, charges, round off and balance due', async () => {
    const req = {
      template: 'compact',
      seller: { name: 'Nova', state: 'Karnataka', gstin: '29ABCDE1234F1Z5' },
      buyer: { name: 'Priya', state: 'Karnataka' },
      prices_include_gst: false,
      currency: 'INR' as const,
      items: [
        { description: 'Line one', quantity: 2, unit_price: 500, gst_rate: 18, discount: 0, discount_pct: 10 },
        { description: 'Line two', quantity: 1, unit_price: 300, gst_rate: 5, discount: 50 },
      ],
      charges: [{ label: 'Shipping', amount: 50, gst_rate: 18 }],
      discount: { percent: 5 },
      round_off: true,
      amount_paid: 100,
      notes: 'Pay on delivery',
    } as unknown as RenderDocumentRequest
    const pdf = await render('compact', 'invoice', req)
    expect(isPdf(pdf)).toBe(true)
  }, 30_000)

  it('renders inter-state (IGST) with no notes and no amount paid', async () => {
    const req = {
      template: 'compact',
      seller: { name: 'Nova', state: 'Karnataka', gstin: '29ABCDE1234F1Z5' },
      buyer: { name: 'Priya', state: 'Tamil Nadu' },
      prices_include_gst: true,
      currency: 'INR' as const,
      items: [{ description: 'Single item', quantity: 1, unit_price: 1180, gst_rate: 18, discount: 0 }],
    } as unknown as RenderDocumentRequest
    const pdf = await render('compact', 'invoice', req)
    expect(isPdf(pdf)).toBe(true)
  }, 30_000)
})

describe('compact family (thermal 80mm roll)', () => {
  const thermalReq = (over: Partial<RenderDocumentRequest> = {}) => ({
    template: 'thermal-80mm',
    seller: { name: 'Nova', state: 'Karnataka', gstin: '29ABCDE1234F1Z5' },
    buyer: { name: 'Priya', state: 'Karnataka' },
    prices_include_gst: false,
    currency: 'INR' as const,
    items: [
      { description: 'Thermal line A', quantity: 3, unit_price: 100, gst_rate: 18, discount: 0 },
      { description: 'Thermal line B', quantity: 1, unit_price: 200, gst_rate: 5, discount: 0 },
    ],
    ...over,
  }) as unknown as RenderDocumentRequest

  it('renders a thermal receipt (PAID, no balance) with a note', async () => {
    const pdf = await render('thermal-80mm', 'receipt', thermalReq({ notes: 'Thanks', amount_paid: 1000 } as any))
    expect(isPdf(pdf)).toBe(true)
  }, 30_000)

  it('renders a thermal invoice intra-state with discount, charges, round off and balance due', async () => {
    const pdf = await render('thermal-80mm', 'invoice', thermalReq({
      discount: { amount: 20 }, charges: [{ label: 'Pack', amount: 10, gst_rate: 18 }],
      round_off: true, amount_paid: 50,
    } as any))
    expect(isPdf(pdf)).toBe(true)
  }, 30_000)

  it('renders a thermal invoice inter-state (IGST) with no notes', async () => {
    const pdf = await render('thermal-80mm', 'invoice', thermalReq({ buyer: { name: 'Priya', state: 'Tamil Nadu' } } as any))
    expect(isPdf(pdf)).toBe(true)
  }, 30_000)

  it('renders a thermal packing slip (prices hidden)', async () => {
    const pdf = await render('thermal-80mm', 'packing_slip', thermalReq())
    expect(isPdf(pdf)).toBe(true)
  }, 30_000)

  it('renders a thermal label via the compact label branch', async () => {
    const pdf = await render('thermal-80mm', 'label', thermalReq({ ship_to: { name: 'Priya (site)', state: 'Karnataka' } } as any))
    expect(isPdf(pdf)).toBe(true)
  }, 30_000)
})
