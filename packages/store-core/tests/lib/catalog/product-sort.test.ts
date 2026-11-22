import { describe, it, expect } from 'vitest'
import { positiveInt, FEATURED_ORDER_SQL, productPriceSql, productSortSql, productOrderBy } from '@/lib/catalog/product-sort'

describe('positiveInt', () => {
  it('parses a positive integer', () => {
    expect(positiveInt('5', 1)).toBe(5)
    expect(positiveInt(42, 1)).toBe(42)
  })
  it('falls back on junk/zero/negative', () => {
    expect(positiveInt('abc', 7)).toBe(7)
    expect(positiveInt('0', 7)).toBe(7)
    expect(positiveInt('-3', 7)).toBe(7)
    expect(positiveInt(null, 7)).toBe(7)
    expect(positiveInt(undefined, 7)).toBe(7)
  })
  it('caps at max', () => {
    expect(positiveInt('1000', 1, 100)).toBe(100)
  })
})

describe('productPriceSql', () => {
  it('GST on: uses base_price and the incl-GST variant min', () => {
    const sql = productPriceSql(true)
    expect(sql).toContain('p.base_price')
    expect(sql).toContain('p.has_variants')
  })
  it('GST off: uses the ex-GST fallbacks', () => {
    const sql = productPriceSql(false)
    expect(sql).toContain('price_ex_gst')
  })
})

describe('productSortSql', () => {
  it('null for an unknown/absent sort', () => {
    expect(productSortSql({}, true)).toBeNull()
    expect(productSortSql({ sort: 'bogus' }, true)).toBeNull()
  })
  it('name sort respects dir', () => {
    expect(productSortSql({ sort: 'name', dir: 'desc' }, true)).toBe('p.name DESC NULLS LAST')
    expect(productSortSql({ sort: 'name' }, true)).toBe('p.name ASC NULLS LAST') // default asc
  })
  it('alias base_price → price → price SQL', () => {
    const sql = productSortSql({ sort: 'base_price' }, true)!
    expect(sql).toContain('p.base_price')
    expect(sql).toMatch(/ASC NULLS LAST$/)
  })
  it('category sort groups by category name then product name', () => {
    expect(productSortSql({ sort: 'category', dir: 'desc' }, true)).toBe('c.name DESC NULLS LAST, p.name ASC')
  })
  it('discount sort defaults desc', () => {
    const sql = productSortSql({ sort: 'discount' }, true)!
    expect(sql).toMatch(/DESC NULLS LAST$/)
  })
  it('stock sort uses the stock rank', () => {
    const sql = productSortSql({ sort: 'stock' }, true)!
    expect(sql).toContain('stock_status')
    expect(sql).toMatch(/DESC NULLS LAST$/)
  })
  it('order is accepted as an alias of dir', () => {
    expect(productSortSql({ sort: 'name', order: 'desc' }, true)).toBe('p.name DESC NULLS LAST')
  })
})

describe('productOrderBy', () => {
  it('appends p.id ASC to the chosen sort', () => {
    expect(productOrderBy({ sort: 'name' }, { gstEnabled: true })).toBe('p.name ASC NULLS LAST, p.id ASC')
  })
  it('uses the fallback (featured) when no sort', () => {
    expect(productOrderBy({}, { gstEnabled: true })).toBe(`${FEATURED_ORDER_SQL}, p.id ASC`)
  })
  it('honours a custom fallback', () => {
    expect(productOrderBy({}, { gstEnabled: true, fallback: 'x DESC' })).toBe('x DESC, p.id ASC')
  })
})
