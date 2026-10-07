import { describe, it, expect } from 'vitest'
import {
  deriveSellableItems,
  monthlyEquivalentLabel,
  normalizeSubscriptionPrice,
  normalizeSubscriptionPrices,
  pickSubscriptionPrice,
  priceInputs,
  subscriptionPriceError,
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

describe('per-interval subscription prices', () => {
  it('carries each level\'s interval price inputs onto its sellable item', () => {
    const items = deriveSellableItems({
      hasVariants: true,
      product: { ...product, subscription_prices: { monthly: 1 } },
      variants: [
        { id: 'v1', variant_name: 'A', subscription_prices: { monthly: 300, yearly: '3000' } },
        { id: 'v2', variant_name: 'B', sub_variant_type_on: true },
      ],
      subVariantsByVariant: {
        v2: [{ id: 's1', sub_variant_name: 'X', subscription_prices: JSON.stringify({ quarterly: 900, daily: 1 }) }],
      },
    })
    expect(items.map(i => [i.key, i.subscriptionPrices])).toEqual([
      ['v:v1', { monthly: '300', yearly: '3000' }],
      ['sv:s1', { quarterly: '900' }],
    ])
  })

  it('normalizes a map: known intervals, positive amounts, paise rounding', () => {
    expect(normalizeSubscriptionPrices({ monthly: '99.999', yearly: '', weekly: -1, quarterly: 0, daily: 5 })).toEqual({
      monthly: 100,
    })
    expect(normalizeSubscriptionPrices('{"yearly": 4999}')).toEqual({ yearly: 4999 })
    expect(normalizeSubscriptionPrices('junk')).toEqual({})
    expect(normalizeSubscriptionPrices(null)).toEqual({})
    expect(priceInputs({ monthly: 0, yearly: null, weekly: '' })).toEqual({ monthly: '0' })
  })

  it('picks the interval price, else the legacy scalar, else null', () => {
    expect(pickSubscriptionPrice({ monthly: '450' }, '480', 'monthly')).toBe(450)
    expect(pickSubscriptionPrice({ monthly: '450' }, '480', 'yearly')).toBe(480)
    expect(pickSubscriptionPrice({ monthly: '0' }, null, 'monthly')).toBeNull()
    expect(pickSubscriptionPrice(null, '', 'weekly')).toBeNull()
  })

  it('validates admin cells against the per-cycle cap', () => {
    expect(subscriptionPriceError('')).toBeNull()
    expect(subscriptionPriceError('15000')).toBeNull()
    expect(subscriptionPriceError('15000.01')).toMatch(/15,000/)
    expect(subscriptionPriceError('-1')).toMatch(/non-negative/)
    expect(subscriptionPriceError('abc')).toMatch(/non-negative/)
  })

  it('labels the monthly equivalent for quarterly / yearly only', () => {
    expect(monthlyEquivalentLabel('yearly', '15996')).toBe('₹1,333/mo')
    expect(monthlyEquivalentLabel('quarterly', 1500)).toBe('₹500/mo')
    expect(monthlyEquivalentLabel('monthly', 499)).toBeNull()
    expect(monthlyEquivalentLabel('yearly', '')).toBeNull()
  })
})
