import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/format', () => ({
  humanizeLabel: (s: string) => s.toUpperCase(),
}))
vi.mock('@/lib/catalog/product-specs', () => ({
  specValues: (v: unknown) => (Array.isArray(v) ? v.map(String) : [String(v)]),
}))

import { itemConditionLd, productExtrasLd, returnPolicyLd } from '@/lib/catalog/product-jsonld'

describe('itemConditionLd', () => {
  it('maps each known condition, open_box → used', () => {
    expect(itemConditionLd({ condition: 'new' })).toBe('https://schema.org/NewCondition')
    expect(itemConditionLd({ condition: 'refurbished' })).toBe('https://schema.org/RefurbishedCondition')
    expect(itemConditionLd({ condition: 'used' })).toBe('https://schema.org/UsedCondition')
    expect(itemConditionLd({ condition: 'open_box' })).toBe('https://schema.org/UsedCondition')
  })

  it('defaults to NewCondition for unknown / missing', () => {
    expect(itemConditionLd({ condition: 'mystery' })).toBe('https://schema.org/NewCondition')
    expect(itemConditionLd(null)).toBe('https://schema.org/NewCondition')
  })
})

describe('productExtrasLd', () => {
  it('builds property values, skipping blanks and non-positive numbers', () => {
    const out = productExtrasLd({
      series: 'S1',
      pack_size: '  ',
      net_quantity: 0,
      warranty_months: 12,
      warranty_type: 'onsite',
      in_the_box: 'Cable\n\nManual\n ',
    })
    const props = out.additionalProperty as any[]
    const byName = Object.fromEntries(props.map(p => [p.name, p.value]))
    expect(byName.Series).toBe('S1')
    expect(byName).not.toHaveProperty('Pack size')
    expect(byName).not.toHaveProperty('Net quantity')
    expect(byName.Warranty).toBe('12 months (onsite)')
    expect(byName["What's in the box"]).toBe('Cable, Manual')
  })

  it('includes net quantity when positive and warranty without a type', () => {
    const out = productExtrasLd({ net_quantity: 5, net_quantity_unit: 'kg', warranty_months: 6 })
    const byName = Object.fromEntries((out.additionalProperty as any[]).map(p => [p.name, p.value]))
    expect(byName['Net quantity']).toBe('5 kg')
    expect(byName.Warranty).toBe('6 months')
  })

  it('adds humanized specs (object only), capped at 30, and truncates values to 500', () => {
    const specifications: Record<string, unknown> = {}
    for (let i = 0; i < 35; i++) specifications[`k${i}`] = `v${i}`
    const out = productExtrasLd({ specifications })
    const specProps = (out.additionalProperty as any[]).filter(p => /^K\d+$/.test(p.name))
    expect(specProps).toHaveLength(30)
    expect(specProps[0].name).toBe('K0')

    const long = productExtrasLd({ specifications: { k: 'x'.repeat(600) } })
    expect((long.additionalProperty as any[]).find(p => p.name === 'K').value.length).toBe(500)
  })

  it('ignores array specifications', () => {
    const out = productExtrasLd({ specifications: ['a', 'b'] })
    expect(out.additionalProperty).toBeUndefined()
  })

  it('emits model, manufacturer, colour, material, origin when present', () => {
    const out = productExtrasLd({
      model_number: 'M1',
      manufacturer_name: 'Acme',
      color: 'Red',
      material: 'Steel',
      country_of_origin: 'IN',
    })
    expect(out.model).toBe('M1')
    expect(out.manufacturer).toEqual({ '@type': 'Organization', name: 'Acme' })
    expect(out.color).toBe('Red')
    expect(out.material).toBe('Steel')
    expect(out.countryOfOrigin).toEqual({ '@type': 'Country', name: 'IN' })
  })

  it('omits additionalProperty when there is nothing', () => {
    expect(productExtrasLd({}).additionalProperty).toBeUndefined()
  })
})

describe('returnPolicyLd', () => {
  it('returns NotPermitted when category or brand forbids returns', () => {
    const out = returnPolicyLd({ categories: { return_allowed: false } })
    expect(out).toEqual({
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'IN',
      returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
    })
    expect(returnPolicyLd({ brands: { return_allowed: false } })?.returnPolicyCategory).toMatch(/NotPermitted/)
  })

  it('uses the first positive window across product, brand, category', () => {
    const out = returnPolicyLd({ return_window_days: 0, brands: { return_window_days: 7 }, categories: { return_window_days: 14 } })
    expect(out?.returnPolicyCategory).toBe('https://schema.org/MerchantReturnFiniteReturnWindow')
    expect(out?.merchantReturnDays).toBe(7)
  })

  it('returns undefined when returns allowed but no window set', () => {
    expect(returnPolicyLd({})).toBeUndefined()
    expect(returnPolicyLd(null)).toBeUndefined()
  })
})
