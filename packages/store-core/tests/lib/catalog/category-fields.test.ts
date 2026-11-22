import { describe, it, expect } from 'vitest'
import {
  CATEGORY_PROFILE_FIELDS,
  CATEGORY_PRODUCT_DEFAULTS,
  resolveCategoryDefaults,
  hsnMatchesPrefixes,
} from '@/lib/catalog/category-fields'

describe('CATEGORY_PROFILE_FIELDS', () => {
  it('every field has unique key, label, kind, section', () => {
    const keys = CATEGORY_PROFILE_FIELDS.map(f => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const f of CATEGORY_PROFILE_FIELDS) {
      expect(f.key).toBeTruthy()
      expect(f.label).toBeTruthy()
      expect(f.kind).toBeTruthy()
      expect(f.section).toBeTruthy()
    }
  })

  it('select option labels are humanised from enum values (opts helper)', () => {
    const taxClass = CATEGORY_PROFILE_FIELDS.find(f => f.key === 'default_tax_class')!
    expect(taxClass.options).toContainEqual({ value: 'standard', label: 'Standard' })
  })
})

describe('resolveCategoryDefaults', () => {
  const cats = [
    { id: 'child', parent_category_id: 'parent', default_hsn_code: '', default_gst_rate: 18, hsn_prefixes: [] },
    { id: 'parent', parent_category_id: 'root', default_hsn_code: '7318', hsn_prefixes: ['7318'] },
    { id: 'root', parent_category_id: null, cod_allowed: true, hsn_prefixes: ['99'] },
  ]

  it('takes the nearest non-blank ancestor value per key', () => {
    const out = resolveCategoryDefaults(cats, 'child')
    // child's hsn is '' (blank) → parent's 7318
    expect(out.default_hsn_code).toBe('7318')
    expect(out.default_gst_rate).toBe(18)
    expect(out.cod_allowed).toBe(true)
  })

  it('picks the nearest ancestor with a non-empty hsn_prefixes array', () => {
    const out = resolveCategoryDefaults(cats, 'child')
    expect(out.hsn_prefixes).toEqual(['7318'])
  })

  it('returns all-null defaults and empty prefixes for an unknown / null id', () => {
    const out = resolveCategoryDefaults(cats, null)
    expect(out.hsn_prefixes).toEqual([])
    for (const k of Object.keys(CATEGORY_PRODUCT_DEFAULTS)) expect(out[k]).toBeNull()
    expect(resolveCategoryDefaults(cats, 'nope').hsn_prefixes).toEqual([])
  })

  it('stops after 10 ancestors (cycle / deep chain safety)', () => {
    const chain = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      parent_category_id: i < 19 ? `c${i + 1}` : null,
      default_gst_rate: i === 15 ? 5 : null,
    }))
    // c15 is 15 hops deep — beyond the 10 cap, so never reached.
    expect(resolveCategoryDefaults(chain, 'c0').default_gst_rate).toBeNull()
  })
})

describe('hsnMatchesPrefixes', () => {
  it('true when hsn blank or no prefixes configured', () => {
    expect(hsnMatchesPrefixes('', ['7318'])).toBe(true)
    expect(hsnMatchesPrefixes(null, ['7318'])).toBe(true)
    expect(hsnMatchesPrefixes('   ', ['7318'])).toBe(true)
    expect(hsnMatchesPrefixes('7318', [])).toBe(true)
  })

  it('true when hsn starts with any (trimmed) prefix, else false', () => {
    expect(hsnMatchesPrefixes('73181500', [' 7318 '])).toBe(true)
    expect(hsnMatchesPrefixes('820412', ['7318', '8204'])).toBe(true)
    expect(hsnMatchesPrefixes('999999', ['7318', '8204'])).toBe(false)
  })
})
