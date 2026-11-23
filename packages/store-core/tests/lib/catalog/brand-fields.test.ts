import { describe, it, expect } from 'vitest'
import { BRAND_SECTIONS, BRAND_PROFILE_FIELDS, BRAND_PRODUCT_DEFAULTS } from '@/lib/catalog/brand-fields'
import { ENUMS } from '@/lib/import/enums'

describe('BRAND_SECTIONS', () => {
  it('lists the five form sections', () => {
    expect(BRAND_SECTIONS).toEqual(['Profile', 'Media', 'Origin & legal', 'Warranty & service', 'SEO'])
  })
})

describe('BRAND_PROFILE_FIELDS', () => {
  it('every field has a key, label, kind and a section drawn from BRAND_SECTIONS', () => {
    for (const f of BRAND_PROFILE_FIELDS) {
      expect(f.key).toBeTruthy()
      expect(f.label).toBeTruthy()
      expect(f.kind).toBeTruthy()
      expect(BRAND_SECTIONS).toContain(f.section as any)
    }
  })

  it('keys are unique', () => {
    const keys = BRAND_PROFILE_FIELDS.map(f => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('opts() title-cases option values and underscores → spaces', () => {
    // brand_type is built via opts(['manufacturer','private_label',...])
    const bt = BRAND_PROFILE_FIELDS.find(f => f.key === 'brand_type')!
    expect(bt.kind).toBe('select')
    expect(bt.options).toContainEqual({ value: 'manufacturer', label: 'Manufacturer' })
    expect(bt.options).toContainEqual({ value: 'private_label', label: 'Private label' })
    expect(bt.fallback).toBe('manufacturer')
  })

  it('warranty_type options drop the empty enum value and title-case the rest', () => {
    const wt = BRAND_PROFILE_FIELDS.find(f => f.key === 'default_warranty_type')!
    // ENUMS.warranty_type = ['', 'manufacturer', 'seller'] — '' is filtered out by opts()
    expect(wt.options?.some(o => o.value === '')).toBe(false)
    const values = wt.options?.map(o => o.value)
    expect(values).toEqual(ENUMS.warranty_type.filter(Boolean))
    expect(wt.options).toContainEqual({ value: 'seller', label: 'Seller' })
  })

  it('social_links is a links field with its subkeys', () => {
    const sl = BRAND_PROFILE_FIELDS.find(f => f.key === 'social_links')!
    expect(sl.kind).toBe('links')
    expect(sl.subkeys).toEqual(['instagram', 'youtube', 'facebook', 'linkedin', 'x'])
    expect(sl.fallback).toEqual({})
  })

  it('founded_year is an int bounded 1700..2100', () => {
    const fy = BRAND_PROFILE_FIELDS.find(f => f.key === 'founded_year')!
    expect(fy.kind).toBe('int')
    expect(fy.min).toBe(1700)
    expect(fy.maxValue).toBe(2100)
  })
})

describe('BRAND_PRODUCT_DEFAULTS', () => {
  it('maps brand columns to the product columns products inherit', () => {
    expect(BRAND_PRODUCT_DEFAULTS.country_of_origin).toBe('country_of_origin')
    expect(BRAND_PRODUCT_DEFAULTS.default_warranty_months).toBe('warranty_months')
    expect(BRAND_PRODUCT_DEFAULTS.default_lead_time_days).toBe('lead_time_days')
  })
  it('every mapped brand key is a real brand field', () => {
    const fieldKeys = new Set(BRAND_PROFILE_FIELDS.map(f => f.key))
    for (const k of Object.keys(BRAND_PRODUCT_DEFAULTS)) expect(fieldKeys.has(k)).toBe(true)
  })
})
