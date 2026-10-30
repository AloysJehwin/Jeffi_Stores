import { describe, it, expect, vi } from 'vitest'
import {
  duplicateSkuError,
  friendlyProductDbError,
  gstError,
  MalformedFieldError,
  paiseString,
  parseJsonField,
  pickUniqueSlug,
  priceErrors,
  productErrorMessage,
  publishShippingError,
  roundMoneyFields,
  skuConflictError,
  slugify,
  storedProductPublishErrors,
  toAmount,
  uniqueProductSlug,
  variantSkuCollisionError,
} from '@/lib/catalog/product-validation'

const db = (rowsFor: (sql: string, params?: unknown[]) => any[]) => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => ({ rows: rowsFor(sql, params) })),
})

describe('slug', () => {
  it('slugifies names', () => {
    expect(slugify('  Bosch 10mm Drill-Bit (Set)! ')).toBe('bosch-10mm-drill-bit-set')
    expect(slugify('')).toBe('')
    expect(slugify(null)).toBe('')
  })

  it('suffixes on conflict with the first free number', () => {
    expect(pickUniqueSlug('drill', [])).toBe('drill')
    expect(pickUniqueSlug('drill', ['drill'])).toBe('drill-2')
    expect(pickUniqueSlug('drill', ['drill', 'drill-2', 'drill-3'])).toBe('drill-4')
    expect(pickUniqueSlug('drill', ['drill-2'])).toBe('drill')
  })

  it('uniqueProductSlug excludes the product itself and ignores unrelated prefixes', async () => {
    const d = db(() => [{ slug: 'drill' }, { slug: 'drill-2' }, { slug: 'drill-bits' }])
    expect(await uniqueProductSlug(d, 'Drill', 'p1')).toBe('drill-3')
    expect(d.query.mock.calls[0][1]).toEqual(['drill', 'p1'])
  })

  it('falls back to "product" for an unsluggable name', async () => {
    expect(
      await uniqueProductSlug(
        db(() => []),
        '!!!'
      )
    ).toBe('product')
  })
})

describe('prices', () => {
  it('parses amounts: blank → null, junk → NaN', () => {
    expect(toAmount('')).toBeNull()
    expect(toAmount(null)).toBeNull()
    expect(toAmount('12.5')).toBe(12.5)
    expect(toAmount('abc')).toBeNaN()
    expect(toAmount('NaN')).toBeNaN()
  })

  it('accepts a valid set and an empty draft', () => {
    expect(priceErrors('P', { price: '90', mrp: '100', cost: '50', discountPct: '10' })).toEqual([])
    expect(priceErrors('P', {})).toEqual([])
  })

  it('rejects negatives, NaN and out-of-range discount', () => {
    expect(priceErrors('P', { price: '-1' })).toEqual(['P: selling price cannot be negative.'])
    expect(priceErrors('P', { mrp: 'abc' })).toEqual(['P: MRP must be a number.'])
    expect(priceErrors('P', { cost: '-5' })).toEqual(['P: cost price cannot be negative.'])
    expect(priceErrors('P', { discountPct: '150' })).toEqual(['P: discount must be between 0 and 100%.'])
  })

  it('rejects a selling price above MRP (incl. and ex. GST)', () => {
    expect(priceErrors('P', { price: '120', mrp: '100' })[0]).toMatch(/cannot be higher than MRP/)
    expect(priceErrors('P', { priceExGst: '120', mrpExGst: '100' })[0]).toMatch(/ex\. GST/)
    expect(priceErrors('P', { price: '100.004', mrp: '100' })).toEqual([])
  })

  it('requires a positive price only when publishing', () => {
    expect(priceErrors('P', { price: '' }, { requirePrice: true })).toEqual([
      'P: selling price is required to publish.',
    ])
    expect(priceErrors('P', { price: '0' }, { requirePrice: true })).toHaveLength(1)
    expect(priceErrors('P', { price: '' }, { requirePrice: false })).toEqual([])
  })

  it('validates GST against the allowed slabs', () => {
    expect(gstError('18')).toBeNull()
    expect(gstError(0)).toBeNull()
    expect(gstError('')).toBeNull()
    expect(gstError('17')).toMatch(/GST rate must be one of/)
    expect(gstError('x')).toMatch(/GST rate/)
  })
})

describe('publishShippingError', () => {
  const base = { isDigital: false, hasVariants: false, variants: [] }

  it('skips digital products', () => {
    expect(publishShippingError({ ...base, isDigital: true, product: {} })).toBeNull()
  })

  it('requires a positive product weight and box dims', () => {
    expect(publishShippingError({ ...base, product: {} })).toMatch(/Shipping weight is required/)
    expect(publishShippingError({ ...base, product: { weight_grams: 0 } })).toMatch(/Shipping weight/)
    expect(publishShippingError({ ...base, product: { weight_grams: 200, package_type: 'corrugated_box' } })).toBe(
      'Dimensions required for this package type'
    )
    expect(
      publishShippingError({
        ...base,
        product: { weight_grams: 200, package_type: 'corrugated_box', length_cm: 1, breadth_cm: 2, height_cm: 3 },
      })
    ).toBeNull()
    expect(publishShippingError({ ...base, product: { weight_grams: 200, package_type: 'flat_poly_m' } })).toBeNull()
  })

  it('checks each variant, and sub-variants with inheritance', () => {
    const product = { weight_grams: 100 }
    expect(
      publishShippingError({ ...base, hasVariants: true, product, variants: [{ label: 'A', weight_grams: '' }] })
    ).toMatch(/variant "A"/)
    expect(
      publishShippingError({ ...base, hasVariants: true, product, variants: [{ label: 'A', subVariants: [] }] })
    ).toMatch(/sub-variants enabled but none added/)
    // Sub-variant inherits the product weight.
    expect(
      publishShippingError({
        ...base,
        hasVariants: true,
        product,
        variants: [{ label: 'A', subVariants: [{ label: 'Red' }] }],
      })
    ).toBeNull()
    expect(
      publishShippingError({
        ...base,
        hasVariants: true,
        product: {},
        variants: [{ label: 'A', package_type: 'long_tube', subVariants: [{ label: 'Red', weight_grams: 5 }] }],
      })
    ).toMatch(/sub-variant "Red" of "A"/)
  })
})

describe('SKU checks', () => {
  const toSku = (n: string) => `P-${n.toUpperCase().replace(/[^A-Z0-9]/g, '')}`

  it('detects variant names that collide into one SKU', () => {
    expect(variantSkuCollisionError(['1/2', '12'], toSku)).toBe(
      'Variants "1/2" and "12" both have SKU "P-12". Rename one of them.'
    )
    expect(variantSkuCollisionError(['Red', 'red'], toSku)).toMatch(/listed twice/)
    expect(variantSkuCollisionError(['--'], toSku)).toMatch(/must contain letters or numbers/)
    expect(variantSkuCollisionError(['Red', 'Blue', ''], toSku)).toBeNull()
  })

  it('duplicateSkuError is case-insensitive', () => {
    expect(
      duplicateSkuError([
        { label: 'a', sku: 'x-1' },
        { label: 'b', sku: 'X-1' },
      ])
    ).toMatch(/both have SKU "X-1"/)
    expect(
      duplicateSkuError([
        { label: 'a', sku: '' },
        { label: 'b', sku: '' },
      ])
    ).toBeNull()
  })

  it('skuConflictError reports the owning product', async () => {
    expect(
      await skuConflictError(
        db(() => []),
        { productSku: 'S1' }
      )
    ).toBeNull()
    expect(
      await skuConflictError(
        db(() => [{ kind: 'product', sku: 'S1', name: 'Other' }]),
        { productSku: 'S1' }
      )
    ).toBe('SKU "S1" is already used by product "Other". Use a different SKU.')
    expect(
      await skuConflictError(
        db(() => [{ kind: 'variant', sku: 'S1-RED', name: 'Other' }]),
        {
          variantSkus: ['S1-RED'],
          productId: 'p1',
        }
      )
    ).toMatch(/used by a variant of "Other"/)
    const d = db(() => [])
    expect(await skuConflictError(d, {})).toBeNull()
    expect(d.query).not.toHaveBeenCalled()
  })
})

describe('friendlyProductDbError', () => {
  it('maps unique violations by constraint', () => {
    expect(
      friendlyProductDbError({
        code: '23505',
        constraint: 'products_sku_key',
        detail: 'Key (sku)=(ABC) already exists.',
      })
    ).toBe('A product with SKU "ABC" already exists. Use a different SKU.')
    expect(
      friendlyProductDbError({
        code: '23505',
        constraint: 'products_slug_key',
        detail: 'Key (slug)=(x) already exists.',
      })
    ).toMatch(/URL "x"/)
    expect(
      friendlyProductDbError({
        code: '23505',
        constraint: 'product_variants_sku_key',
        detail: 'Key (sku)=(V) already exists.',
      })
    ).toMatch(/Variant SKU "V"/)
    expect(friendlyProductDbError({ code: '23505', constraint: 'product_sub_variants_sku_key' })).toMatch(
      /Sub-variant SKU/
    )
    expect(
      friendlyProductDbError({ message: 'duplicate key value violates unique constraint "products_sku_key"' })
    ).toMatch(/A product with SKU/)
  })

  it('maps other common codes', () => {
    expect(friendlyProductDbError({ code: '23502', column: 'name' })).toBe('Required field "name" is missing.')
    expect(friendlyProductDbError({ code: '23503' })).toMatch(/no longer exists/)
    expect(friendlyProductDbError({ code: '22P02', message: 'invalid input syntax for type uuid: ""' })).toMatch(
      /category, brand or supplier is invalid/
    )
    expect(friendlyProductDbError({ code: '22P02', message: 'invalid input syntax for type numeric' })).toMatch(
      /number field/
    )
    expect(friendlyProductDbError({ code: '23514', constraint: 'products_digital_no_variants_check' })).toMatch(
      /Digital products cannot have variants/
    )
    expect(friendlyProductDbError(new Error('boom'))).toBeNull()
    expect(friendlyProductDbError(null)).toBeNull()
  })

  it('productErrorMessage falls back to the message, then the fallback', () => {
    expect(productErrorMessage(new Error('boom'), 'x')).toBe('boom')
    expect(productErrorMessage({}, 'fallback')).toBe('fallback')
  })
})

describe('parseJsonField', () => {
  it('parses, defaults and labels malformed input', () => {
    expect(parseJsonField('[1]', 'f', [])).toEqual([1])
    expect(parseJsonField(null, 'f', [])).toEqual([])
    expect(parseJsonField('', 'f', 'd')).toBe('d')
    expect(parseJsonField('null', 'f', [])).toEqual([])
    expect(() => parseJsonField('{bad', 'variants', [])).toThrow(MalformedFieldError)
    expect(() => parseJsonField('{bad', 'variants', [])).toThrow(/"variants"/)
  })
})

describe('storedProductPublishErrors (create-draft publish)', () => {
  const productRow = {
    name: 'Drill',
    category_id: 'c1',
    base_price: '100',
    mrp: '120',
    gst_percentage: '18',
    has_variants: false,
    is_digital: false,
    weight_grams: 200,
    package_type: 'flat_poly_m',
  }

  it('passes a complete simple product', async () => {
    expect(
      await storedProductPublishErrors(
        db(() => [productRow]),
        'p1'
      )
    ).toEqual([])
  })

  it('lists every missing piece of a placeholder draft', async () => {
    const errs = await storedProductPublishErrors(
      db(() => [{ ...productRow, name: 'Untitled draft', category_id: null, base_price: '0', weight_grams: null }]),
      'p1'
    )
    expect(errs).toEqual([
      'Product name is required.',
      'Category is required.',
      'Pricing: selling price is required to publish.',
      'Shipping weight is required and must be greater than 0.',
    ])
  })

  it('checks variant prices and sub-variant shipping', async () => {
    const d = db(sql =>
      sql.includes('FROM products')
        ? [{ ...productRow, has_variants: true, weight_grams: null }]
        : sql.includes('FROM product_variants')
          ? [
              { id: 'v1', variant_name: 'A', price: '', weight_grams: 10 },
              { id: 'v2', variant_name: 'B', sub_variant_type_on: true },
            ]
          : [{ variant_id: 'v2', sub_variant_name: 'Red', price: '50', mrp: '40' }]
    )
    const errs = await storedProductPublishErrors(d, 'p1')
    expect(errs).toContain('Sub-variant "Red" of "B": selling price (₹50) cannot be higher than MRP (₹40).')
    expect(errs).toContain('Variant "A": selling price is required to publish.')
    expect(errs).toContain('Shipping weight is required for sub-variant "Red" of "B" and must be greater than 0.')
  })

  it('reports a missing product', async () => {
    expect(
      await storedProductPublishErrors(
        db(() => []),
        'p1'
      )
    ).toEqual(['Product not found.'])
  })
})

describe('paise rounding', () => {
  it('rounds loaded float noise but leaves typed input alone', () => {
    expect(paiseString(999.9999679999999)).toBe('1000')
    expect(paiseString('999.9999679999999')).toBe('1000')
    expect(paiseString('847.457627')).toBe('847.46')
    expect(paiseString('1000.00')).toBe('1000.00')
    expect(paiseString('10.')).toBe('10.')
    expect(paiseString('')).toBe('')
    expect(paiseString(null)).toBe('')
    expect(paiseString(NaN)).toBe('')
  })

  it('rounds the money fields of a row only', () => {
    expect(
      roundMoneyFields({ price: '999.9999679999', mrp: 1180.000001, cost_price: '', weight_grams: 12.3456, sku: 'X' })
    ).toEqual({ price: 1000, mrp: 1180, cost_price: '', weight_grams: 12.3456, sku: 'X' })
  })
})
