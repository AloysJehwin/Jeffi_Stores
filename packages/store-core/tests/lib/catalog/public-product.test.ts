import { describe, it, expect } from 'vitest'
import { INTERNAL_PRODUCT_KEYS, publicProduct, publicProducts } from '@/lib/catalog/public-product'

describe('publicProduct', () => {
  it('strips every internal key and keeps the rest', () => {
    const row = {
      id: 'p1',
      name: 'Wire',
      internal_notes: 'secret',
      source_url: 'http://x',
      cost_price: 10,
      supplier_id: 's1',
      search_vector: 'tsv',
    }
    const out = publicProduct(row)
    for (const k of INTERNAL_PRODUCT_KEYS) expect(out).not.toHaveProperty(k)
    expect(out).toEqual({ id: 'p1', name: 'Wire' })
  })

  it('does not mutate the source row', () => {
    const row = { id: 'p1', cost_price: 10 }
    publicProduct(row)
    expect(row.cost_price).toBe(10)
  })

  it('passes through non-objects untouched', () => {
    expect(publicProduct(null as any)).toBeNull()
    expect(publicProduct(undefined as any)).toBeUndefined()
    expect(publicProduct('x' as any)).toBe('x')
    expect(publicProduct(5 as any)).toBe(5)
  })
})

describe('publicProducts', () => {
  it('maps over every row', () => {
    const rows = [
      { id: 'a', cost_price: 1 },
      { id: 'b', supplier_id: 's' },
    ]
    expect(publicProducts(rows)).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('returns an empty array for no rows', () => {
    expect(publicProducts([])).toEqual([])
  })
})
