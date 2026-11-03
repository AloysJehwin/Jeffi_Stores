// A selling unit's max_qty caps one cart line (product + variant + sub-variant + buy_mode),
// measured in that unit. Adds merge into the line, so the cap covers in-cart + adding.

const EPS = 1e-6

export interface CartLineLike {
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  buy_mode: string | null
  quantity: number | string
}

export interface CartLineKey {
  productId: string
  variantId?: string | null
  subVariantId?: string | null
  buyMode?: string | null
}

export function inCartQuantity(items: CartLineLike[], key: CartLineKey): number {
  const mode = key.buyMode || 'unit'
  return items
    .filter(
      ci =>
        ci.product_id === key.productId &&
        (ci.variant_id ?? null) === (key.variantId ?? null) &&
        (ci.sub_variant_id ?? null) === (key.subVariantId ?? null) &&
        (ci.buy_mode || 'unit') === mode
    )
    .reduce((sum, ci) => sum + (Number(ci.quantity) || 0), 0)
}

/** Quantity still addable to the line; undefined when the unit has no max. */
export function remainingUnitQty(maxQty: number | null | undefined, inCart: number): number | undefined {
  if (maxQty == null || !Number.isFinite(Number(maxQty))) return undefined
  const left = Number(maxQty) - (Number(inCart) || 0)
  return left > EPS ? Number(left.toFixed(6)) : 0
}

function fmt(n: number): string {
  return String(Number(n.toFixed(6)))
}

/** Null when `adding` fits under the cap, else the user-facing reason. */
export function unitCapError(maxQty: number | null | undefined, inCart: number, adding: number): string | null {
  const left = remainingUnitQty(maxQty, inCart)
  if (left === undefined || adding <= left + EPS) return null
  if (left <= 0) return `Max quantity already in cart (max ${fmt(Number(maxQty))})`
  return `You can add up to ${fmt(left)} more — ${fmt(inCart)} already in your cart (max ${fmt(Number(maxQty))})`
}

export interface PickerQtyCap {
  inCart: number
  /** Min for the picker input (relaxed when the line already exists). */
  min: number
  /** Max for the picker input; undefined = uncapped. */
  max: number | undefined
  /** True when the line already holds max_qty. */
  full: boolean
}

/** Effective picker bounds for adding to the selected line. */
export function pickerQtyCap(maxQty: number | null | undefined, inCart: number, minQty = 1): PickerQtyCap {
  const left = remainingUnitQty(maxQty, inCart)
  const full = left !== undefined && left <= 0
  // The merged line already met min_qty, so a smaller top-up is allowed.
  const min = inCart > 0 && left !== undefined && !full ? Math.min(minQty, left) : minQty
  return { inCart, min, max: left, full }
}
