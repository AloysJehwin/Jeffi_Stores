import type { CartLine } from '../../api/cart'
import { inr } from '../../lib/format'

// Cart pricing exactly as the web's CartContext (getCartTotal / getCartTax) and digital-lines.ts compute it.

export const money = (n: number | string | null | undefined) => `₹${inr(n)}`

/** "ft2" → "ft²" (the web's UnitLabel superscript). */
export function unitText(label: string | null | undefined): string {
  if (!label) return ''
  const m = label.match(/^(.+?)2$/)
  return m ? `${m[1]}²` : label
}

/** Trim float noise: 1.500000 → "1.5". */
export const qtyText = (q: number | string) => Number(Number(q).toFixed(6)).toString()

export function pickUnitPrice(inclusive: unknown, exGst: unknown, gstEnabled: boolean): number {
  const incl = Number(inclusive ?? 0)
  if (gstEnabled) return incl
  const ex = exGst == null ? null : Number(exGst)
  return ex != null && ex > 0 ? ex : incl
}

export const isCustomQty = (item: CartLine) =>
  !!(item.cart_item_unit?.dimension && item.cart_item_unit.dimension !== 'count')

export const unitFactor = (item: CartLine) =>
  !isCustomQty(item) && item.cart_item_unit?.factor ? Number(item.cart_item_unit.factor) : 1

export const inclusiveUnit = (item: CartLine) =>
  Number(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)

export const exGstUnit = (item: CartLine) =>
  item.sub_variant?.price_ex_gst ?? item.variant?.price_ex_gst ?? item.products.price_ex_gst

export const isDigitalLine = (item: CartLine) => item.is_digital === true || item.products?.is_digital === true

export const primaryImage = (item: CartLine) =>
  item.products.product_images?.find(i => i.is_primary) || item.products.product_images?.[0] || null

export const lineSku = (item: CartLine) => item.sub_variant?.sku || item.variant?.sku || item.products.sku

export function cartTotal(items: CartLine[], gstEnabled: boolean): number {
  return items.reduce((total, item) => {
    const custom = isCustomQty(item)
    const factor = unitFactor(item)
    const price = !gstEnabled
      ? pickUnitPrice(inclusiveUnit(item), exGstUnit(item), false) * factor
      : custom
        ? Number(item.price_at_addition)
        : inclusiveUnit(item) * factor
    return total + price * Number(item.quantity)
  }, 0)
}

export function cartTax(items: CartLine[], gstEnabled: boolean): number {
  if (!gstEnabled) return 0
  return items.reduce((tax, item) => {
    const price = isCustomQty(item) ? Number(item.price_at_addition) : inclusiveUnit(item) * unitFactor(item)
    const rate = Number(item.products.gst_percentage || 0)
    const lineTotal = price * Number(item.quantity)
    return tax + (lineTotal - lineTotal / (1 + rate / 100))
  }, 0)
}

export function digitalLinesSubtotal(items: CartLine[], gstEnabled: boolean): number {
  return items.reduce((sum, item) => {
    if (!isDigitalLine(item)) return sum
    return sum + pickUnitPrice(item.products?.base_price, item.products?.price_ex_gst, gstEnabled) * Number(item.quantity)
  }, 0)
}
