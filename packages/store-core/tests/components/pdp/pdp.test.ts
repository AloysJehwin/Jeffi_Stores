import { describe, it, expect } from 'vitest'
import { canAddDirectly, purchasableNow, stickyBarAction, sumPrices } from '@/components/visitor/pdp/pdp'

describe('canAddDirectly', () => {
  it('accepts in-stock products without variants', () => {
    expect(canAddDirectly({ hasVariants: false, effectiveStock: 1 })).toBe(true)
  })

  it('rejects variant products and out-of-stock products', () => {
    expect(canAddDirectly({ hasVariants: true, effectiveStock: 12 })).toBe(false)
    expect(canAddDirectly({ hasVariants: false, effectiveStock: 0 })).toBe(false)
  })
})

describe('purchasableNow', () => {
  const now = new Date(2026, 8, 25, 15, 30)

  it('is purchasable with no launch or discontinue date', () => {
    expect(purchasableNow(null, undefined, now)).toBe(true)
  })

  it('is not purchasable before the launch date', () => {
    expect(purchasableNow(new Date(2026, 8, 26), null, now)).toBe(false)
    expect(purchasableNow(new Date(2026, 8, 25), null, now)).toBe(true)
  })

  it('is not purchasable on or after the discontinue date', () => {
    expect(purchasableNow(null, new Date(2026, 8, 25), now)).toBe(false)
    expect(purchasableNow(null, new Date(2026, 8, 26), now)).toBe(true)
  })
})

describe('sumPrices', () => {
  it('adds prices without floating point drift', () => {
    expect(sumPrices([{ displayPrice: 0.1 }, { displayPrice: 0.2 }, { displayPrice: 99.71 }])).toBe(100.01)
  })

  it('is zero for an empty selection', () => {
    expect(sumPrices([])).toBe(0)
  })
})

describe('stickyBarAction', () => {
  const inStock = [{ stock_status: 'In Stock' }]
  const base = { purchasable: true, hasVariants: false, variants: [], selectionInStock: true, needsChoice: false }

  it('adds directly for an in-stock product without variants', () => {
    expect(stickyBarAction(base)).toBe('add')
  })

  it('hides for an out-of-stock product without variants', () => {
    expect(stickyBarAction({ ...base, selectionInStock: false })).toBeNull()
  })

  it('hides when the product cannot be bought at all', () => {
    expect(stickyBarAction({ ...base, purchasable: false })).toBeNull()
    expect(stickyBarAction({ ...base, hasVariants: true, variants: [{ stock_status: 'Out of Stock' }] })).toBeNull()
  })

  it('sends the shopper to the options when a choice is missing or the selection is sold out', () => {
    const variant = { ...base, hasVariants: true, variants: inStock }
    expect(stickyBarAction({ ...variant, needsChoice: true })).toBe('choose')
    expect(stickyBarAction({ ...variant, selectionInStock: false })).toBe('choose')
  })

  it('adds the current selection when it is complete and in stock', () => {
    expect(stickyBarAction({ ...base, hasVariants: true, variants: inStock })).toBe('add')
  })
})
