import { describe, it, expect } from 'vitest'
import {
  SPEC_PARAM_PREFIX,
  SPEC_SECTION,
  specParam,
  specKeyFromParam,
  splitFilterValues,
  joinFilterValues,
  ADMIN_PRODUCT_FILTER_FIELDS,
  filterParamNames,
} from '@/lib/catalog/product-attribute-filters-shared'

describe('spec param constants', () => {
  it('exposes the expected prefix and section', () => {
    expect(SPEC_PARAM_PREFIX).toBe('spec.')
    expect(SPEC_SECTION).toBe('Technical Specifications')
  })
})

describe('specParam', () => {
  it('prefixes and swaps spaces for underscores', () => {
    expect(specParam('thread size')).toBe('spec.thread_size')
    expect(specParam('length')).toBe('spec.length')
  })
})

describe('specKeyFromParam', () => {
  it('reverses specParam losslessly', () => {
    expect(specKeyFromParam('spec.thread_size')).toBe('thread size')
    expect(specKeyFromParam('spec.length')).toBe('length')
  })

  it('returns null for a non-spec param', () => {
    expect(specKeyFromParam('color')).toBeNull()
    expect(specKeyFromParam('spec_thread')).toBeNull()
  })

  it('returns null for an empty key', () => {
    expect(specKeyFromParam('spec.')).toBeNull()
    expect(specKeyFromParam('spec.   ')).toBeNull()
  })

  it('rejects an over-long key', () => {
    expect(specKeyFromParam('spec.' + 'a'.repeat(121))).toBeNull()
    expect(specKeyFromParam('spec.' + 'a'.repeat(120))).toBe('a'.repeat(120))
  })
})

describe('re-exported value helpers', () => {
  it('splits and joins on the pipe separator', () => {
    expect(splitFilterValues('a|b|c')).toEqual(['a', 'b', 'c'])
    expect(joinFilterValues(['a', 'b'])).toBe('a|b')
  })
})

describe('ADMIN_PRODUCT_FILTER_FIELDS', () => {
  it('includes the core product-type booleans', () => {
    const names = ADMIN_PRODUCT_FILTER_FIELDS.map(f => f.name).filter(n => typeof n === 'string')
    expect(names).toContain('is_featured')
    expect(names).toContain('is_digital')
  })

  it('carries a range field with paired min/max names', () => {
    const price = ADMIN_PRODUCT_FILTER_FIELDS.find(f => f.label === 'Price Range')!
    expect(price.type).toBe('range')
    expect(price.name).toEqual(['price_min', 'price_max'])
  })

  it('builds value-help fields with an "Any <label>" placeholder', () => {
    const supplier = ADMIN_PRODUCT_FILTER_FIELDS.find(f => f.name === 'supplier')!
    expect(supplier.type).toBe('value-help')
    expect(supplier.placeholder).toBe('Any supplier')
  })
})

describe('filterParamNames', () => {
  it('wraps a single string name in an array', () => {
    expect(filterParamNames({ name: 'color' } as any)).toEqual(['color'])
  })

  it('returns an array name as-is', () => {
    expect(filterParamNames({ name: ['price_min', 'price_max'] } as any)).toEqual(['price_min', 'price_max'])
  })
})
