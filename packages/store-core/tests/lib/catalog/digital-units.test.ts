import { describe, it, expect, vi } from 'vitest'
import {
  DIGITAL_UNIT_MESSAGE,
  digitalUnitError,
  isPieceUnit,
  normalizeDigitalProduct,
  stripDigitalUnits,
  zeroDigitalStock,
} from '@/lib/catalog/digital-units'

describe('digital unit rules', () => {
  it('accepts only the plain piece unit', () => {
    for (const u of [null, undefined, '', 'unit', 'pcs', 'PC', 'piece', 'each']) expect(isPieceUnit(u)).toBe(true)
    for (const u of ['box', 'kg', 'm', 'pack10']) expect(isPieceUnit(u)).toBe(false)
  })

  it('flags a digital line that asks for a non-piece unit', () => {
    expect(digitalUnitError('unit', 'unit')).toBeNull()
    expect(digitalUnitError(undefined, null)).toBeNull()
    expect(digitalUnitError('box', 'box')).toBe(DIGITAL_UNIT_MESSAGE)
    expect(digitalUnitError('unit', 'kg')).toBe(DIGITAL_UNIT_MESSAGE)
  })
})

describe('digital normalization SQL', () => {
  it('drops selling units and the sell-unit pointer', async () => {
    const db = { query: vi.fn(async (_sql: string, _params?: unknown[]) => ({})) }
    await stripDigitalUnits(db, 'p1')
    const sql = db.query.mock.calls.map(c => String(c[0]))
    expect(sql[0]).toContain('SET sell_unit_id = NULL')
    expect(sql[1]).toBe('DELETE FROM product_units WHERE product_id = $1')
    expect(db.query.mock.calls.every(c => (c as any)[1][0] === 'p1')).toBe(true)
  })

  it('zeroes stock and turns tracking off', async () => {
    const db = { query: vi.fn(async (_sql: string, _params?: unknown[]) => ({})) }
    await zeroDigitalStock(db, 'p1')
    const sql = db.query.mock.calls.map(c => String(c[0])).join('\n')
    expect(sql).toContain('DELETE FROM shelf_stock')
    expect(sql).toContain("DELETE FROM product_serials WHERE product_id = $1 AND status = 'in_stock'")
    expect(sql).toContain('DELETE FROM product_batches')
    expect(sql).toMatch(/inventory_quantity = 0, stock_status = 'In Stock', perishable = FALSE, serialized = FALSE/)
    expect(sql).toContain('inventory_sync = FALSE')
  })

  it('normalizes stock then units', async () => {
    const db = { query: vi.fn(async (_sql: string, _params?: unknown[]) => ({})) }
    await normalizeDigitalProduct(db, 'p1')
    const sql = db.query.mock.calls.map(c => String(c[0]))
    expect(sql.findIndex(s => s.includes('inventory_quantity = 0, stock_status'))).toBeLessThan(
      sql.findIndex(s => s.includes('DELETE FROM product_units'))
    )
  })
})
