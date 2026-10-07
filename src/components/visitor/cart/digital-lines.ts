import { pickUnitPrice } from '@/lib/catalog/pricing'

interface LineLike {
  is_digital?: boolean | null
  quantity: number | string
  products?: { is_digital?: boolean | null; base_price?: number | null; price_ex_gst?: number | null } | null
}

export function isDigitalLine(item: LineLike): boolean {
  return item.is_digital === true || item.products?.is_digital === true
}

/**
 * Value of the digital lines, priced the way CartContext.getCartTotal prices them (digital products
 * have no variants or selling units). Subtract it from the cart total to get the physical subtotal
 * that drives the free-shipping threshold.
 */
export function digitalLinesSubtotal(items: LineLike[], gstEnabled: boolean): number {
  return items.reduce((sum, item) => {
    if (!isDigitalLine(item)) return sum
    const price = pickUnitPrice(
      { inclusive: item.products?.base_price, exGst: item.products?.price_ex_gst },
      gstEnabled
    )
    return sum + price * Number(item.quantity)
  }, 0)
}
