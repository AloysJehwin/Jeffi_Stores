export interface WishlistBadgeInput {
  hasVariants: boolean
  shownPrice: number
  shownInStock: boolean
  basePrice: number | string | null
  inventoryInStock: boolean | null
  snapshotPrice: number | string | null
  snapshotInStock: boolean | null
}

export interface WishlistBadges {
  backInStock: boolean
  priceDrop: { was: number; pct: number } | null
}

/**
 * The wishlist snapshot is written by the price-drop / restock campaigns from the product's
 * GST-inclusive base_price and inventory_quantity > 0, so both checks compare those same fields.
 * Variant products are skipped: their card price is the variant minimum, not base_price.
 */
export function wishlistBadges(i: WishlistBadgeInput): WishlistBadges {
  const backInStock = i.snapshotInStock === false && i.inventoryInStock === true && i.shownInStock

  const snapshot = Number(i.snapshotPrice)
  const current = Number(i.basePrice)
  let priceDrop: WishlistBadges['priceDrop'] = null
  if (!i.hasVariants && snapshot > 0 && current > 0 && current < snapshot && i.shownPrice > 0) {
    const pct = Math.round(((snapshot - current) / snapshot) * 100)
    // The card may show the ex-GST price, so the old price is scaled onto the shown basis.
    if (pct >= 1) priceDrop = { was: Math.round(((i.shownPrice * snapshot) / current) * 100) / 100, pct }
  }
  return { backInStock, priceDrop }
}
