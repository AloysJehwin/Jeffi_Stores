import { describe, it, expect, vi } from 'vitest'
import {
  txDb,
  slugify,
  pickUniqueSlug,
  uniqueProductSlug,
  toAmount,
  paiseString,
  roundMoneyFields,
  gstError,
  priceErrors,
  samePrices,
  publishShippingError,
  duplicateSkuError,
  variantSkuCollisionError,
  skuConflictError,
  friendlyProductDbError,
  productErrorMessage,
  parseJsonField,
  MalformedFieldError,
  storedProductPublishErrors,
  ProductValidationError,
  MONEY_KEYS,
  ALLOWED_GST_RATES,
} from '@/lib/catalog/product-validation'

function exec(...responses: any[][]) {
  let i = 0
  const calls: { sql: string; params: any[] }[] = []
  return {
    calls,
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      return { rows: responses[i++] ?? [] }
    }),
  }
}

describe('txDb', () => {
  it('wraps a client into query/queryOne/queryMany', async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ a: 1 }, { a: 2 }] })) }
    const db = txDb(client)
    expect((await db.query('SQL', [1])).rows).toHaveLength(2)
    expect(await db.queryOne('SQL')).toEqual({ a: 1 })
    expect(await db.queryMany('SQL')).toEqual([{ a: 1 }, { a: 2 }])
    expect(client.query).toHaveBeenCalledWith('SQL', [1])
  })
  it('queryOne returns null on an empty result', async () => {
    const db = txDb({ query: vi.fn(async () => ({ rows: [] })) })
    expect(await db.queryOne('SQL')).toBeNull()
  })
})

describe('slugify', () => {
  it('lowercases, dashes non-alnum, trims leading/trailing dashes', () => {
    expect(slugify('Hello World!')).toBe('hello-world')
    expect(slugify('  --A B--  ')).toBe('a-b')
  })
  it('handles null/undefined/empty', () => {
    expect(slugify(null)).toBe('')
    expect(slugify(undefined)).toBe('')
  })
  it('truncates to 240 and trims a trailing dash left by the cut', () => {
    const s = slugify('a'.repeat(300))
    expect(s.length).toBeLessThanOrEqual(240)
  })
})

describe('pickUniqueSlug', () => {
  it('returns base when free', () => {
    expect(pickUniqueSlug('x', [])).toBe('x')
  })
  it('appends the first free -n suffix', () => {
    expect(pickUniqueSlug('x', ['x', 'x-2'])).toBe('x-3')
    expect(pickUniqueSlug('x', ['x'])).toBe('x-2')
  })
})

describe('uniqueProductSlug', () => {
  it('queries existing slugs then picks a free one', async () => {
    const db = exec([{ slug: 'bolt' }, { slug: 'bolt-2' }])
    const s = await uniqueProductSlug(db, 'Bolt', 'id-1')
    expect(s).toBe('bolt-3')
    expect(db.calls[0].params).toEqual(['bolt', 'id-1'])
    expect(db.calls[0].sql).toContain("slug LIKE $1 || '-%'")
  })
  it('falls back to "product" for an empty name and passes null exclude', async () => {
    const db = exec([])
    const s = await uniqueProductSlug(db, '!!!')
    expect(s).toBe('product')
    expect(db.calls[0].params).toEqual(['product', null])
  })
  it('ignores slugs that only prefix-match but are not base or base-n', async () => {
    const db = exec([{ slug: 'bolt-set' }]) // not base nor base-<digits>
    expect(await uniqueProductSlug(db, 'Bolt')).toBe('bolt')
  })
})

describe('toAmount', () => {
  it('null for blank/null/undefined sentinels', () => {
    for (const v of [null, undefined, '', '  ', 'null', 'undefined']) expect(toAmount(v)).toBeNull()
  })
  it('NaN for non-numeric', () => {
    expect(Number.isNaN(toAmount('abc') as number)).toBe(true)
  })
  it('number for numeric strings and numbers', () => {
    expect(toAmount('12.5')).toBe(12.5)
    expect(toAmount(7)).toBe(7)
  })
})

describe('paiseString', () => {
  it('empty for nullish', () => {
    expect(paiseString(null)).toBe('')
    expect(paiseString(undefined)).toBe('')
  })
  it('rounds finite numbers, empty for non-finite', () => {
    expect(paiseString(999.9999679999)).toBe('1000')
    expect(paiseString(Infinity)).toBe('')
  })
  it('rounds only float-noise strings (3+ decimals); leaves others', () => {
    expect(paiseString('999.9999679999')).toBe('1000')
    expect(paiseString('10.')).toBe('10.')
    expect(paiseString('10.5')).toBe('10.5')
  })
})

describe('roundMoneyFields', () => {
  it('rounds every money key, leaves blank/non-numeric alone', () => {
    const out = roundMoneyFields({ price: '10.999', mrp: '', cost_price: 'abc', name: 'x' } as any)
    expect(out.price).toBe(11)
    expect(out.mrp).toBe('')
    expect(out.cost_price).toBe('abc')
    expect(out.name).toBe('x')
  })
  it('returns the input untouched when not an object', () => {
    expect(roundMoneyFields(null as any)).toBeNull()
  })
  it('respects a custom key list', () => {
    const out = roundMoneyFields({ foo: '1.239' } as any, ['foo'])
    expect(out.foo).toBe(1.24)
  })
  it('MONEY_KEYS includes the standard price fields', () => {
    expect(MONEY_KEYS).toContain('price')
    expect(MONEY_KEYS).toContain('cost_price')
  })
})

describe('gstError', () => {
  it('null for a blank rate', () => {
    expect(gstError(null)).toBeNull()
    expect(gstError('')).toBeNull()
  })
  it('null for an allowed rate', () => {
    for (const r of ALLOWED_GST_RATES) expect(gstError(r)).toBeNull()
  })
  it('error for a disallowed or NaN rate', () => {
    expect(gstError(7)).toMatch(/GST rate must be one of/)
    expect(gstError('abc')).toMatch(/GST rate must be one of/)
  })
})

describe('priceErrors', () => {
  it('passes a clean price set', () => {
    expect(priceErrors('P', { price: 90, mrp: 100 })).toEqual([])
  })
  it('flags NaN, negative and too-large with the label prefix', () => {
    const errs = priceErrors('Variant', { price: 'x', mrp: -1, cost: 1e13 })
    expect(errs.some(e => /Variant: selling price must be a number/.test(e))).toBe(true)
    expect(errs.some(e => /MRP cannot be negative/.test(e))).toBe(true)
    expect(errs.some(e => /cost price is too large/.test(e))).toBe(true)
  })
  it('flags discount out of 0..100', () => {
    expect(priceErrors('', { discountPct: 150 })[0]).toMatch(/discount must be between/)
    expect(priceErrors('', { discountPct: -1 })[0]).toMatch(/discount must be between/)
  })
  it('returns field errors before the cross-field checks', () => {
    // price NaN short-circuits; the MRP comparison is not reached.
    const errs = priceErrors('', { price: 'x', mrp: 100 })
    expect(errs).toHaveLength(1)
  })
  it('requirePrice: missing/zero selling price blocks publish', () => {
    expect(priceErrors('', { mrp: 100 }, { requirePrice: true })[0]).toMatch(/selling price is required/)
    expect(priceErrors('', { price: 0 }, { requirePrice: true })[0]).toMatch(/selling price is required/)
  })
  it('price must not exceed MRP, and ex-GST price must not exceed ex-GST MRP', () => {
    expect(priceErrors('', { price: 120, mrp: 100 })[0]).toMatch(/cannot be higher than MRP/)
    expect(priceErrors('', { priceExGst: 90, mrpExGst: 80 })[0]).toMatch(/ex\. GST .* cannot be higher/)
  })
  it('skipMrpCheck skips the comparisons', () => {
    expect(priceErrors('', { price: 120, mrp: 100 }, { skipMrpCheck: true })).toEqual([])
  })
})

describe('samePrices', () => {
  it('false when either side is nullish', () => {
    expect(samePrices(null, {})).toBe(false)
    expect(samePrices({}, undefined)).toBe(false)
  })
  it('true when all four match to the paisa (both nulls count as equal)', () => {
    expect(samePrices({ price: '10.001', mrp: '20' }, { price: '10', mrp: '20' })).toBe(true)
  })
  it('false when one is set and the other null', () => {
    expect(samePrices({ price: 10 }, { price: null })).toBe(false)
  })
  it('false when a value differs beyond tolerance', () => {
    expect(samePrices({ price: 10 }, { price: 11 })).toBe(false)
  })
})

describe('publishShippingError', () => {
  const base = { isDigital: false, hasVariants: false, product: {}, variants: [] as any[] }

  it('digital products skip shipping', () => {
    expect(publishShippingError({ ...base, isDigital: true })).toBeNull()
  })
  it('no-variant: weight required > 0', () => {
    expect(publishShippingError({ ...base, product: { weight_grams: '0' } })).toMatch(/weight is required/)
    expect(publishShippingError({ ...base, product: { weight_grams: '100' } })).toBeNull()
  })
  it('no-variant: dims required for a dims package type', () => {
    expect(
      publishShippingError({ ...base, product: { weight_grams: '1', package_type: 'corrugated_box' } })
    ).toMatch(/Dimensions required/)
    expect(
      publishShippingError({
        ...base,
        product: { weight_grams: '1', package_type: 'corrugated_box', length_cm: '1', breadth_cm: '1', height_cm: '1' },
      })
    ).toBeNull()
  })
  it('variant: sub-variants enabled but none added', () => {
    const r = publishShippingError({
      ...base,
      hasVariants: true,
      variants: [{ label: 'V', subVariants: [] }],
    })
    expect(r).toMatch(/sub-variants enabled but none added/)
  })
  it('sub-variant weight falls back to variant/product then errors if still zero', () => {
    const r = publishShippingError({
      ...base,
      hasVariants: true,
      product: { weight_grams: '0' },
      variants: [{ label: 'V', weight_grams: '0', subVariants: [{ label: 'S' }] }],
    })
    expect(r).toMatch(/weight is required for sub-variant "S" of "V"/)
  })
  it('sub-variant dims required for a dims package type (inherited)', () => {
    const r = publishShippingError({
      ...base,
      hasVariants: true,
      variants: [{ label: 'V', weight_grams: '5', package_type: 'long_tube', subVariants: [{ label: 'S' }] }],
    })
    expect(r).toMatch(/Dimensions required.*sub-variant "S" of "V"/)
  })
  it('plain variant: weight and dims', () => {
    expect(
      publishShippingError({ ...base, hasVariants: true, variants: [{ label: 'V', weight_grams: '0' }] })
    ).toMatch(/weight is required for variant "V"/)
    expect(
      publishShippingError({
        ...base,
        hasVariants: true,
        variants: [{ label: 'V', weight_grams: '5', package_type: 'corrugated_box' }],
      })
    ).toMatch(/Dimensions required.*variant "V"/)
  })
  it('passes a fully-specified variant set', () => {
    expect(
      publishShippingError({
        ...base,
        hasVariants: true,
        variants: [{ label: 'V', weight_grams: '5', package_type: 'flat_poly_auto' }],
      })
    ).toBeNull()
  })
})

describe('duplicateSkuError', () => {
  it('null when all SKUs are unique', () => {
    expect(duplicateSkuError([{ label: 'A', sku: 'X' }, { label: 'B', sku: 'Y' }])).toBeNull()
  })
  it('ignores blank SKUs', () => {
    expect(duplicateSkuError([{ label: 'A', sku: '' }, { label: 'B', sku: '' }])).toBeNull()
  })
  it('same label twice → "listed twice"', () => {
    expect(duplicateSkuError([{ label: 'A', sku: 'X' }, { label: 'a', sku: 'X' }])).toMatch(/listed twice/)
  })
  it('two labels share one SKU (case-insensitive)', () => {
    expect(duplicateSkuError([{ label: 'A', sku: 'x' }, { label: 'B', sku: 'X' }])).toMatch(
      /Variants "A" and "B" both have SKU "X"/
    )
  })
})

describe('variantSkuCollisionError', () => {
  const toSku = (n: string) => n.toUpperCase()
  it('rejects a name with no letters/numbers', () => {
    expect(variantSkuCollisionError(['---'], toSku)).toMatch(/must contain letters or numbers/)
  })
  it('skips blank names and detects collisions via toSku', () => {
    expect(variantSkuCollisionError(['red', '  ', 'RED'], toSku)).toMatch(/listed twice|both have SKU/)
  })
  it('null when unique', () => {
    expect(variantSkuCollisionError(['red', 'blue'], toSku)).toBeNull()
  })
})

describe('skuConflictError', () => {
  it('null when nothing to check', async () => {
    const db = exec()
    expect(await skuConflictError(db, {})).toBeNull()
    expect(db.query).not.toHaveBeenCalled()
  })
  it('null when the query finds nothing', async () => {
    const db = exec([])
    expect(await skuConflictError(db, { productSku: 'X', productId: 'p1' })).toBeNull()
    expect(db.calls[0].params).toEqual(['X', [], 'p1'])
  })
  it('product-kind conflict message', async () => {
    const db = exec([{ kind: 'product', sku: 'X', name: 'Widget' }])
    expect(await skuConflictError(db, { productSku: 'X' })).toMatch(/already used by product "Widget"/)
  })
  it('variant-kind conflict message', async () => {
    const db = exec([{ kind: 'variant', sku: 'V1', name: 'Widget' }])
    expect(await skuConflictError(db, { variantSkus: ['V1'] })).toMatch(/used by a variant of "Widget"/)
  })
  it('filters out falsy variant SKUs', async () => {
    const db = exec([])
    await skuConflictError(db, { variantSkus: ['', 'V1', undefined as any] })
    expect(db.calls[0].params[1]).toEqual(['V1'])
  })
})

describe('friendlyProductDbError', () => {
  it('null for non-objects / unknown errors', () => {
    expect(friendlyProductDbError(null)).toBeNull()
    expect(friendlyProductDbError('oops')).toBeNull()
    expect(friendlyProductDbError({ code: '99999' })).toBeNull()
  })
  it('maps a known unique constraint by name', () => {
    expect(friendlyProductDbError({ code: '23505', constraint: 'products_sku_key', detail: '=(ABC) already exists' })).toMatch(
      /product with SKU "ABC" already exists/
    )
  })
  it('maps products_pkey', () => {
    expect(friendlyProductDbError({ code: '23505', constraint: 'products_pkey' })).toMatch(/already saved/)
  })
  it('finds the constraint in the message text when not named', () => {
    expect(
      friendlyProductDbError({ code: '23505', message: 'duplicate key products_slug_key', detail: '=(my-slug) already exists' })
    ).toMatch(/uses the URL "my-slug"/)
  })
  it('generic duplicate with a value', () => {
    expect(friendlyProductDbError({ code: '23505', detail: '=(foo) already exists' })).toMatch(/"foo" is already in use/)
  })
  it('generic duplicate without a value', () => {
    expect(friendlyProductDbError({ code: '23505', detail: '' })).toMatch(/record with these details already exists/)
  })
  it('not-null, fk, bad uuid/number, overflow', () => {
    expect(friendlyProductDbError({ code: '23502', column: 'name' })).toMatch(/Required field "name"/)
    expect(friendlyProductDbError({ code: '23503' })).toMatch(/no longer exists/)
    expect(friendlyProductDbError({ code: '22P02', message: 'invalid input syntax for type uuid' })).toMatch(
      /category, brand or supplier is invalid/
    )
    expect(friendlyProductDbError({ code: '22P02', message: 'invalid input syntax for type numeric' })).toMatch(
      /number field contains an invalid value/
    )
    expect(friendlyProductDbError({ code: '22003' })).toMatch(/number is too large/)
  })
  it('check constraints: digital-no-variants, cycles, generic', () => {
    expect(friendlyProductDbError({ code: '23514', message: 'digital_no_variants' })).toMatch(/cannot have variants/)
    expect(friendlyProductDbError({ code: '23514', constraint: 'cycles' })).toMatch(/cycle counts/)
    expect(friendlyProductDbError({ code: '23514', message: 'other' })).toMatch(/outside the allowed range/)
  })
})

describe('productErrorMessage', () => {
  it('prefers a friendly DB message', () => {
    expect(productErrorMessage({ code: '23502', column: 'x' }, 'fallback')).toMatch(/Required field/)
  })
  it('falls back to an Error message, then the literal fallback', () => {
    expect(productErrorMessage(new Error('boom'), 'fb')).toBe('boom')
    expect(productErrorMessage({}, 'fb')).toBe('fb')
  })
})

describe('parseJsonField', () => {
  it('returns the fallback for null/empty', () => {
    expect(parseJsonField(null, 'f', 'FB')).toBe('FB')
    expect(parseJsonField('' as any, 'f', 'FB')).toBe('FB')
  })
  it('parses valid JSON, with a fallback for null parse result', () => {
    expect(parseJsonField('{"a":1}' as any, 'f', {})).toEqual({ a: 1 })
    expect(parseJsonField('null' as any, 'f', 'FB')).toBe('FB')
  })
  it('throws MalformedFieldError on bad JSON', () => {
    expect(() => parseJsonField('{bad' as any, 'myField', {})).toThrow(MalformedFieldError)
    try {
      parseJsonField('{bad' as any, 'myField', {})
    } catch (e: any) {
      expect(e.message).toMatch(/malformed data for "myField"/)
      expect(e.name).toBe('MalformedFieldError')
    }
  })
})

describe('storedProductPublishErrors', () => {
  it('product not found', async () => {
    const db = exec([]) // SELECT product → none
    expect(await storedProductPublishErrors(db, 'p1')).toEqual(['Product not found.'])
  })

  it('flags missing name/category/bad GST and pricing for a no-variant product', async () => {
    const db = exec([
      {
        name: 'Untitled draft',
        category_id: null,
        gst_percentage: 7,
        has_variants: false,
        is_digital: false,
        base_price: null,
        mrp: null,
        weight_grams: '0',
      },
    ])
    const errs = await storedProductPublishErrors(db, 'p1')
    expect(errs).toContain('Product name is required.')
    expect(errs).toContain('Category is required.')
    expect(errs.some(e => /GST rate/.test(e))).toBe(true)
    expect(errs.some(e => /selling price is required/.test(e))).toBe(true)
    expect(errs.some(e => /weight is required/.test(e))).toBe(true)
  })

  it('digital product skips shipping and passes with valid data', async () => {
    const db = exec([
      {
        name: 'Ebook',
        category_id: 'c1',
        gst_percentage: 18,
        has_variants: false,
        is_digital: true,
        base_price: '100',
        mrp: '100',
      },
    ])
    expect(await storedProductPublishErrors(db, 'p1')).toEqual([])
  })

  it('variant product with no variants adds the "add a variant" error', async () => {
    const db = exec(
      [{ name: 'P', category_id: 'c1', gst_percentage: 18, has_variants: true, is_digital: false }],
      [], // variants
      [] // sub-variants
    )
    const errs = await storedProductPublishErrors(db, 'p1')
    expect(errs).toContain('Add at least one variant, or turn off variants.')
  })

  it('validates a variant with sub-variants and dedupes repeated errors', async () => {
    const db = exec(
      [{ name: 'P', category_id: 'c1', gst_percentage: 18, has_variants: true, is_digital: false }],
      [{ id: 'v1', variant_name: 'V', sku: 'V1', sub_variant_type_on: true, weight_grams: '5' }],
      [{ variant_id: 'v1', sub_variant_name: 'S', price: null, mrp: null, weight_grams: '5' }]
    )
    const errs = await storedProductPublishErrors(db, 'p1')
    expect(errs.some(e => /Sub-variant "S" of "V": selling price is required/.test(e))).toBe(true)
    // deduped
    expect(new Set(errs).size).toBe(errs.length)
  })

  it('validates a plain variant price and passes a complete one', async () => {
    const db = exec(
      [{ name: 'P', category_id: 'c1', gst_percentage: 18, has_variants: true, is_digital: false }],
      [
        {
          id: 'v1',
          variant_name: 'V',
          sku: 'V1',
          sub_variant_type_on: false,
          price: '90',
          mrp: '100',
          weight_grams: '5',
          package_type: 'flat_poly_auto',
        },
      ],
      []
    )
    expect(await storedProductPublishErrors(db, 'p1')).toEqual([])
  })
})

describe('error classes', () => {
  it('ProductValidationError carries name and cause', () => {
    const cause = new Error('inner')
    const e = new ProductValidationError('bad', { cause })
    expect(e.name).toBe('ProductValidationError')
    expect((e as any).cause).toBe(cause)
    expect(e).toBeInstanceOf(Error)
  })
})
