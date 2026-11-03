import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ withTransaction: vi.fn() }))
vi.mock('@/lib/orders/inventory', () => ({
  logStockMovement: vi.fn(),
  recomputeStockStatusForProduct: vi.fn(),
}))
vi.mock('@/lib/catalog/shelf', () => ({ syncPerishableStock: vi.fn() }))

import {
  invoiceLineSchema,
  quotationLineSchema,
  priceInvoiceLines,
  quotationLineRow,
  quotationTotals,
  lineFactor,
  formatShortfall,
  buildShortfall,
} from '@/lib/documents/invoice-line-items'
import { resolveLineUnit, checkLineStock, deductOrderStock } from '@/lib/orders/inventory-deduct'
import { logStockMovement } from '@/lib/orders/inventory'

const PID = '11111111-1111-4111-8111-111111111111'

describe('custom-line validation', () => {
  const custom = { product_id: null, product_name: 'Installation', unit_price: 500, quantity: 1, unit: 'JOB' }

  it('accepts a custom line with no product', () => {
    expect(invoiceLineSchema.safeParse(custom).success).toBe(true)
  })

  it.each([
    [{ product_name: '  ' }, 'product_name'],
    [{ quantity: 0 }, 'quantity'],
    [{ quantity: -2 }, 'quantity'],
    [{ unit_price: 0 }, 'unit_price'],
    [{ unit_price: -5 }, 'unit_price'],
    [{ gst_rate: 41 }, 'gst_rate'],
    [{ gst_rate: -1 }, 'gst_rate'],
    [{ unit: 'PIECES-LONG' }, 'unit'],
    [{ variant_id: PID }, 'product_id'],
  ])('rejects %o on %s', (patch, field) => {
    const r = invoiceLineSchema.safeParse({ ...custom, ...patch })
    expect(r.success).toBe(false)
    expect(r.error!.issues.map(i => i.path.join('.'))).toContain(field)
  })

  it('allows a zero rate on store-product lines but not on custom lines', () => {
    expect(invoiceLineSchema.safeParse({ ...custom, product_id: PID, unit_price: 0 }).success).toBe(true)
    expect(quotationLineSchema.safeParse({ description: 'X', quantity: 1, rate: 0 }).success).toBe(false)
  })

  it('keeps 0% GST as 0 (not the 18% default)', () => {
    const r = quotationLineSchema.parse({ description: 'X', quantity: 1, rate: 10, gst_rate: 0 })
    expect(quotationLineRow(r, true).gst_rate).toBe(0)
  })
})

describe('pricing', () => {
  it('custom lines never scale by a unit factor and keep their own unit', () => {
    const line = invoiceLineSchema.parse({
      product_name: 'Cable laying',
      unit: 'mtr',
      unit_price: 118,
      quantity: 2.5,
      gst_rate: 18,
      sell_unit_factor: 10,
    })
    const priced = priceInvoiceLines([line], { gstEnabled: true, orderIsIgst: false })
    const l = priced.lines[0]
    expect(l.product_id).toBeNull()
    expect(l.buy_unit).toBe('MTR')
    expect(l.sold_unit_factor).toBeNull()
    expect(l.total_price).toBe(295)
    expect(l.taxable_amount).toBe(250)
  })

  it('count units price on base pieces (2 × SET of 10 @ ₹5/pc)', () => {
    expect(lineFactor({ product_id: PID, sell_unit_factor: 10, sell_unit_dimension: 'count' })).toBe(10)
    expect(lineFactor({ product_id: PID, sell_unit_factor: 1000, sell_unit_dimension: 'weight' })).toBe(1)
    const q = quotationLineSchema.parse({
      description: 'Bolt',
      quantity: 2,
      rate: 5,
      product_id: PID,
      sell_unit_factor: 10,
      sell_unit_dimension: 'count',
    })
    const row = quotationLineRow(q, true)
    expect(row).toMatchObject({ amount: 100, sold_unit_factor: 10, base_quantity: 20 })
  })

  it('quotation total equals the converted invoice total (rate per base piece)', () => {
    // Mirrors convert-to-invoice: exGst = baseQty × rate × (1-d); tax per line; total rounded once.
    const lines = [
      quotationLineSchema.parse({ description: 'A', quantity: 3, rate: 12.345, gst_rate: 18, discount_pct: 7 }),
      quotationLineSchema.parse({
        description: 'B',
        quantity: 2,
        rate: 4.2,
        gst_rate: 5,
        product_id: PID,
        sell_unit_factor: 10,
        sell_unit_dimension: 'count',
      }),
    ]
    const rows = lines.map(l => quotationLineRow(l, true))
    const quote = quotationTotals(rows)
    let sub = 0
    let tax = 0
    for (const r of rows) {
      const base = r.sold_unit_factor ? r.quantity * r.sold_unit_factor : r.quantity
      const ex = base * r.rate * (1 - r.discount_pct / 100)
      sub += ex
      tax += (ex * r.gst_rate) / 100
    }
    expect(Math.round((sub + tax) * 100) / 100).toBe(quote.total_amount)
  })
})

describe('shortfall message', () => {
  it('reports selling unit and pieces', () => {
    const s = buildShortfall('Bolt', 'set', 10, 20, 15)!
    expect(formatShortfall(s)).toBe('Bolt — need 2 SET (20 pcs), available 15 pcs, short 5 pcs (0.5 SET)')
  })
  it('pieces only when there is no factor; null when stock covers it', () => {
    expect(formatShortfall(buildShortfall('Nut', null, 1, 3, 1)!)).toBe(
      'Nut — need 3 pcs, available 1 pcs, short 2 pcs'
    )
    expect(buildShortfall('Nut', null, 1, 3, 3)).toBeNull()
  })
})

describe('resolveLineUnit — fallback order', () => {
  const SET = { unit: 'SET', factor: '10', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null }
  const client = (row: any) => ({ query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) })
  const base = { product_id: PID, variant_id: null, sub_variant_id: null, quantity: '2' }

  it('1. snapshotted base_quantity wins over the unit row', async () => {
    const c = client(SET)
    const r = await resolveLineUnit(c, { ...base, buy_unit: 'SET', base_quantity: '30' })
    expect(r.baseQty).toBe(30)
  })

  it('1b. sold_unit_factor snapshot when base_quantity is absent', async () => {
    const r = await resolveLineUnit(client(null), { ...base, sold_unit_factor: '10' })
    expect(r.baseQty).toBe(20)
  })

  it('2-4. otherwise the unit row resolved by buy_unit → sold_unit → default sell unit', async () => {
    const c = client(SET)
    const r = await resolveLineUnit(c, { ...base, buy_unit: null, sold_unit: 'SET' }, { defaultUnitFallback: true })
    expect(r.baseQty).toBe(20)
    expect(r.unit?.unit).toBe('SET')
    const [sql, params] = c.query.mock.calls[0]
    // priority order in the single query, and the params feeding each branch
    expect(sql.indexOf('pu.unit = $1')).toBeLessThan(sql.indexOf('pu.unit = $5'))
    expect(sql.indexOf('pu.unit = $5')).toBeLessThan(sql.indexOf('v.sell_unit_id'))
    expect(sql.indexOf('v.sell_unit_id')).toBeLessThan(sql.indexOf('p.sell_unit_id'))
    expect(params).toEqual([null, PID, null, null, 'SET', true])
  })

  it('default sell unit is off unless asked for (online cart lines are per piece)', async () => {
    const c = client(null)
    const r = await resolveLineUnit(c, { ...base })
    expect(r.baseQty).toBe(2)
    expect(c.query.mock.calls[0][1][5]).toBe(false)
  })

  it('checkLineStock skips custom lines entirely', async () => {
    const c = client(null)
    const out = await checkLineStock(c, [{ product_id: null, quantity: 5, product_name: 'Custom' }])
    expect(out).toEqual([])
    expect(c.query).not.toHaveBeenCalled()
  })
})

describe('deductOrderStock — RFQ-converted line with NULL buy_unit', () => {
  it('deducts the snapshotted base quantity (2 SET → 20 pcs), same as the stock check', async () => {
    const responses = [
      { rows: [] }, // sale guard
      {
        rows: [
          {
            id: 'oi1',
            product_id: PID,
            variant_id: null,
            sub_variant_id: null,
            product_name: 'Bolt',
            variant_name: null,
            quantity: '2',
            buy_unit: null,
            sold_unit: 'SET',
            sold_unit_factor: '10',
            base_quantity: '20',
          },
        ],
      },
      { rows: [] }, // unit row (none)
      { rows: [{ perishable: false, serialized: false }] },
      { rows: [{ inventory_quantity: '50' }] },
      { rows: [] },
    ]
    let i = 0
    const client: any = { query: vi.fn(async () => responses[i++] ?? { rows: [] }) }
    await deductOrderStock('ord-9', { defaultUnitFallback: true }, client)
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ quantityChange: -20 }))
  })
})
