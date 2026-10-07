import { describe, it, expect } from 'vitest'
import {
  deriveSellableItems,
  normalizeSubscriptionPrice,
  subscriptionPriceHint,
  subscriptionSavingsPct,
} from '@/lib/subscriptions/sellable'

const product = { name: 'Coffee', sku: 'COF', price: '500', subscription_price: '450' }

describe('deriveSellableItems', () => {
  it('sells the product itself when it has no variants', () => {
    const items = deriveSellableItems({ hasVariants: false, product, variants: [], subVariantsByVariant: {} })
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'product',
        name: 'Coffee',
        sku: 'COF',
        oneTimePrice: 500,
        subscriptionPrice: '450',
      }),
    ])
  })

  it('treats variants-on with no live variants as the product', () => {
    const items = deriveSellableItems({
      hasVariants: true,
      product,
      variants: [{ id: 'v1', variant_name: 'A', _isDeleted: true }],
      subVariantsByVariant: {},
    })
    expect(items.map(i => i.kind)).toEqual(['product'])
  })

  it('sells variants, and only the sub-variants of a variant that has them', () => {
    const items = deriveSellableItems({
      hasVariants: true,
      product,
      variants: [
        { id: 'v1', variant_name: '250g', sku: 'COF-250', price: '300', subscription_price: '270' },
        { id: 'v2', variant_name: '1kg', sku: 'COF-1K', price: '900', sub_variant_type_on: true },
        { id: 'v3', variant_name: 'Gone', _isDeleted: true },
        { id: 'v4', variant_name: 'Subs off', price: '100', sub_variant_type_on: false },
      ],
      subVariantsByVariant: {
        v2: [
          { id: 'sv1', sub_variant_name: 'Whole', sku: 'COF-1K-W', price: '950', subscription_price: '800' },
          { id: 'sv2', sub_variant_name: 'Ground', sku: 'COF-1K-G', price: null },
          { id: 'sv3', sub_variant_name: 'Retired', is_active: false },
          { id: 'sv4', sub_variant_name: 'Cleared', _cleared: true },
        ],
        v4: [{ id: 'sv9', sub_variant_name: 'ignored' }],
      },
    })
    expect(items.map(i => i.key)).toEqual(['v:v1', 'sv:sv1', 'sv:sv2', 'v:v4'])
    expect(items[0]).toMatchObject({ kind: 'variant', variantId: 'v1', subVariantId: null, subscriptionPrice: '270' })
    expect(items[1]).toMatchObject({ kind: 'sub_variant', variantId: 'v2', subVariantId: 'sv1', name: '1kg / Whole' })
    // A sub-variant without its own price inherits the parent variant's one-time price.
    expect(items[2]).toMatchObject({ oneTimePrice: 900, subscriptionPrice: '' })
  })

  it('sells the variant when "has sub-variants" is on but none exist yet', () => {
    const items = deriveSellableItems({
      hasVariants: true,
      product,
      variants: [{ id: 'v1', variant_name: 'A', sub_variant_type_on: true }],
      subVariantsByVariant: {},
    })
    expect(items.map(i => i.kind)).toEqual(['variant'])
  })
})

describe('subscription price helpers', () => {
  it('hints how the subscription compares with one-time', () => {
    expect(subscriptionPriceHint(500, '450')).toBe('10% less')
    expect(subscriptionPriceHint(500, 550)).toBe('10% more')
    expect(subscriptionPriceHint(500, '500')).toBeNull()
    expect(subscriptionPriceHint(500, '')).toBeNull()
    expect(subscriptionPriceHint(null, '450')).toBeNull()
  })

  it('computes savings only when cheaper', () => {
    expect(subscriptionSavingsPct(500, 450)).toBe(10)
    expect(subscriptionSavingsPct(500, 500)).toBe(0)
    expect(subscriptionSavingsPct(500, 600)).toBe(0)
    expect(subscriptionSavingsPct(0, 10)).toBe(0)
  })

  it('normalizes admin input: blank / zero / junk → null, else paise-rounded', () => {
    expect(normalizeSubscriptionPrice('')).toBeNull()
    expect(normalizeSubscriptionPrice(' ')).toBeNull()
    expect(normalizeSubscriptionPrice('0')).toBeNull()
    expect(normalizeSubscriptionPrice('-5')).toBeNull()
    expect(normalizeSubscriptionPrice('abc')).toBeNull()
    expect(normalizeSubscriptionPrice(null)).toBeNull()
    expect(normalizeSubscriptionPrice('99.456')).toBe(99.46)
    expect(normalizeSubscriptionPrice(120)).toBe(120)
  })
})
