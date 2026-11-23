import { describe, it, expect } from 'vitest'
import {
  BRAND_DEFAULTS_SQL,
  CATEGORY_HSN_SQL,
  withBrandDefaults,
} from '@/lib/catalog/catalog-defaults'
import { BRAND_PRODUCT_DEFAULTS } from '@/lib/catalog/brand-fields'

describe('SQL fragments', () => {
  it('BRAND_DEFAULTS_SQL names every brand default key off alias b', () => {
    expect(BRAND_DEFAULTS_SQL).toMatch(/^json_build_object\(/)
    expect(BRAND_DEFAULTS_SQL).toMatch(/\) AS brand_defaults$/)
    for (const k of Object.keys(BRAND_PRODUCT_DEFAULTS)) {
      expect(BRAND_DEFAULTS_SQL).toContain(`'${k}', b.${k}`)
    }
  })

  it('CATEGORY_HSN_SQL walks category then parent category', () => {
    expect(CATEGORY_HSN_SQL).toContain('LEFT JOIN categories c ON c.id = p.category_id')
    expect(CATEGORY_HSN_SQL).toContain('LEFT JOIN categories pc ON pc.id = c.parent_category_id')
    expect(CATEGORY_HSN_SQL).toContain('ANY($1::uuid[])')
  })
})

describe('withBrandDefaults', () => {
  const [brandKey, productKey] = Object.entries(BRAND_PRODUCT_DEFAULTS)[0]

  it('passes non-objects through untouched', () => {
    expect(withBrandDefaults(null as any)).toBeNull()
    expect(withBrandDefaults('x' as any)).toBe('x')
  })

  it('drops brand_defaults and leaves fields when there are no defaults', () => {
    const out = withBrandDefaults({ id: 'p', [productKey]: 'set', brand_defaults: null } as any)
    expect(out).not.toHaveProperty('brand_defaults')
    expect(out).not.toHaveProperty('inherited')
    expect((out as any)[productKey]).toBe('set')
  })

  it('fills a blank product field from the brand and records inheritance', () => {
    const out = withBrandDefaults({
      id: 'p',
      [productKey]: '   ',
      brand_defaults: { [brandKey]: 'from-brand' },
    } as any)
    expect((out as any)[productKey]).toBe('from-brand')
    expect(out.inherited).toEqual({ [productKey]: 'brand' })
    expect(out).not.toHaveProperty('brand_defaults')
  })

  it('leaves a non-blank product field and omits inherited when nothing is filled', () => {
    const out = withBrandDefaults({
      id: 'p',
      [productKey]: 'mine',
      brand_defaults: { [brandKey]: 'from-brand' },
    } as any)
    expect((out as any)[productKey]).toBe('mine')
    expect(out).not.toHaveProperty('inherited')
  })

  it('does not fill when the brand default is also blank', () => {
    const out = withBrandDefaults({
      id: 'p',
      [productKey]: null,
      brand_defaults: { [brandKey]: '  ' },
    } as any)
    expect((out as any)[productKey]).toBeNull()
    expect(out).not.toHaveProperty('inherited')
  })
})
