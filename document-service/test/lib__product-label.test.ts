import { describe, it, expect } from 'vitest'
import { productLabel, variantLabel, hasVariantGrain } from '../src/lib/product-label.js'

describe('productLabel', () => {
  it('joins all three grains with the default separator', () => {
    expect(productLabel({ product_name: 'Wire', variant_name: 'Red', sub_variant_name: '10mm' })).toBe(
      'Wire / Red / 10mm'
    )
  })
  it('omits absent grains without a dangling separator', () => {
    expect(productLabel({ product_name: 'Wire', variant_name: null, sub_variant_name: '10mm' })).toBe(
      'Wire / 10mm'
    )
  })
  it('honours a custom separator and trims', () => {
    expect(productLabel({ product_name: ' Wire ', sub_variant_name: '10mm' }, ' - ')).toBe('Wire - 10mm')
  })
})

describe('variantLabel', () => {
  it('returns only the grain suffix below the product', () => {
    expect(variantLabel({ product_name: 'Wire', variant_name: 'Red', sub_variant_name: '10mm' })).toBe(
      'Red / 10mm'
    )
  })
  it('is empty when there is no variant grain', () => {
    expect(variantLabel({ product_name: 'Wire' })).toBe('')
  })
})

describe('hasVariantGrain', () => {
  it('true when a variant/sub-variant exists', () => {
    expect(hasVariantGrain({ product_name: 'Wire', variant_name: 'Red' })).toBe(true)
  })
  it('false when only the product name is present', () => {
    expect(hasVariantGrain({ product_name: 'Wire', variant_name: null, sub_variant_name: '' })).toBe(false)
  })
})
