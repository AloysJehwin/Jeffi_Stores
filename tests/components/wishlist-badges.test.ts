import { describe, it, expect } from 'vitest'
import { wishlistBadges, type WishlistBadgeInput } from '@/components/visitor/account/wishlist-badges'

const BASE: WishlistBadgeInput = {
  hasVariants: false,
  shownPrice: 1180,
  shownInStock: true,
  basePrice: '1180.00',
  inventoryInStock: true,
  snapshotPrice: null,
  snapshotInStock: null,
}

describe('wishlistBadges', () => {
  it('shows nothing without a snapshot', () => {
    expect(wishlistBadges(BASE)).toEqual({ backInStock: false, priceDrop: null })
  })

  it('flags a price drop against the GST-inclusive base price', () => {
    const b = wishlistBadges({ ...BASE, snapshotPrice: '1475.00' })
    expect(b.priceDrop).toEqual({ was: 1475, pct: 20 })
  })

  it('scales the old price onto an ex-GST shown price', () => {
    const b = wishlistBadges({ ...BASE, shownPrice: 1000, basePrice: '1180.00', snapshotPrice: '1475.00' })
    expect(b.priceDrop).toEqual({ was: 1250, pct: 20 })
  })

  it('ignores price rises, sub-1% moves and missing prices', () => {
    expect(wishlistBadges({ ...BASE, snapshotPrice: '1000.00' }).priceDrop).toBeNull()
    expect(wishlistBadges({ ...BASE, snapshotPrice: '1183.00' }).priceDrop).toBeNull()
    expect(wishlistBadges({ ...BASE, basePrice: 0, snapshotPrice: '1475.00' }).priceDrop).toBeNull()
  })

  it('skips variant products, whose shown price is not base_price', () => {
    expect(wishlistBadges({ ...BASE, hasVariants: true, snapshotPrice: '1475.00' }).priceDrop).toBeNull()
  })

  it('flags back in stock only when out at the snapshot and in stock on both bases now', () => {
    expect(wishlistBadges({ ...BASE, snapshotInStock: false }).backInStock).toBe(true)
    expect(wishlistBadges({ ...BASE, snapshotInStock: true }).backInStock).toBe(false)
    expect(wishlistBadges({ ...BASE, snapshotInStock: null }).backInStock).toBe(false)
    expect(wishlistBadges({ ...BASE, snapshotInStock: false, inventoryInStock: false }).backInStock).toBe(false)
    expect(wishlistBadges({ ...BASE, snapshotInStock: false, shownInStock: false }).backInStock).toBe(false)
  })
})
