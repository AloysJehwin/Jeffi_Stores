import { describe, it, expect } from 'vitest'
import { productLabel, variantLabel, hasVariantGrain } from '@/lib/catalog/product-label'

describe('productLabel', () => {
  it('joins all three grains with the default separator', () => {
    expect(productLabel({ product_name: 'Wire', variant_name: 'Red', sub_variant_name: '10mm' })).toBe('Wire / Red / 10mm')
  })

  it('omits absent grains, no dangling separator', () => {
    expect(productLabel({ product_name: 'Wire', variant_name: null, sub_variant_name: '10mm' })).toBe('Wire / 10mm')
    expect(productLabel({ product_name: 'Wire' })).toBe('Wire')
  })

  it('trims whitespace and drops blank parts', () => {
    expect(productLabel({ product_name: '  Wire ', variant_name: '   ', sub_variant_name: 'X' })).toBe('Wire / X')
  })

  it('honours a custom separator', () => {
    expect(productLabel({ product_name: 'A', variant_name: 'B' }, ' - ')).toBe('A - B')
  })

  it('is empty when nothing is set', () => {
    expect(productLabel({})).toBe('')
  })
})

describe('variantLabel', () => {
  it('joins only variant and sub-variant', () => {
    expect(variantLabel({ product_name: 'Wire', variant_name: 'Red', sub_variant_name: '10mm' })).toBe('Red / 10mm')
  })

  it('is empty when only the product name is present', () => {
    expect(variantLabel({ product_name: 'Wire' })).toBe('')
  })
})

describe('hasVariantGrain', () => {
  it('is true when a grain below the product exists', () => {
    expect(hasVariantGrain({ product_name: 'Wire', variant_name: 'Red' })).toBe(true)
  })

  it('is false when only the product name is set', () => {
    expect(hasVariantGrain({ product_name: 'Wire' })).toBe(false)
    expect(hasVariantGrain({})).toBe(false)
  })
})
