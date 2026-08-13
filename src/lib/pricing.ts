// ─── Core arithmetic (no server-only imports — safe for client components) ────

/** Apply a single discount percentage to a price. */
export function applyDiscount(price: number, discountPct: number): number {
  return price * (1 - discountPct / 100)
}

/**
 * Stack two discount percentages multiplicatively.
 * e.g. 30% product + 10% B2B = 37% effective (not 40%).
 */
export function stackDiscounts(d1: number, d2: number): number {
  return (1 - (1 - d1 / 100) * (1 - d2 / 100)) * 100
}

/**
 * Compute the ex-GST amount for a quotation / invoice line item.
 * rate = MRP ex-GST (anchor); discountPct applied on top.
 */
export function lineItemExGst(qty: number, rate: number, discountPct: number): number {
  return qty * rate * (1 - discountPct / 100)
}

/** Full line amount including GST. */
export function lineItemInclGst(qty: number, rate: number, discountPct: number, gstRate: number): number {
  const exGst = lineItemExGst(qty, rate, discountPct)
  return exGst * (1 + gstRate / 100)
}

/**
 * Compute incl-GST line total from MRP incl-GST.
 * Strips GST → applies discount → adds GST back.
 * This is the canonical calculation used everywhere.
 */
export function lineItemFromMrpIncl(qty: number, mrpIncl: number, discountPct: number, gstRate: number): number {
  const mrpEx = mrpIncl / (1 + gstRate / 100)
  return lineItemInclGst(qty, mrpEx, discountPct, gstRate)
}

/**
 * Display-only discount badge percentage — how much off MRP is the displayed price.
 * Returns 0 when mrp is falsy or mrp ≤ price.
 */
export function mrpDiscountPct(mrp: number | null | undefined, price: number): number {
  if (!mrp || mrp <= price) return 0
  return Math.round(((mrp - price) / mrp) * 100)
}

/**
 * Choose the unit price for a line based on the GST feature flag.
 *
 * Product prices are stored GST-INCLUSIVE. When GST is enabled we charge that
 * inclusive price. When GST is disabled we charge the stored ex-GST price
 * (`price_ex_gst`) instead — no recalculation — falling back to the inclusive
 * price when the ex-GST column is NULL / 0. So "GST off" genuinely charges the
 * lower ex-GST amount and there is no embedded tax to strip.
 */
export function pickUnitPrice(
  fields: { inclusive: number | null | undefined; exGst: number | null | undefined },
  gstEnabled: boolean,
): number {
  const incl = Number(fields.inclusive ?? 0)
  if (gstEnabled) return incl
  const ex = fields.exGst == null ? null : Number(fields.exGst)
  return ex != null && ex > 0 ? ex : incl
}

/**
 * Resolve the winning unit price across the sub_variant → variant → product
 * precedence, honouring the GST flag at every level. Each level supplies its
 * inclusive price and its ex-GST price; the most specific level with a value
 * wins. Keeps the precedence rule in one place so every call site agrees.
 */
export function resolveLineUnitPrice(
  levels: {
    subVariant?: { inclusive: number | null | undefined; exGst: number | null | undefined } | null
    variant?: { inclusive: number | null | undefined; exGst: number | null | undefined } | null
    product: { inclusive: number | null | undefined; exGst: number | null | undefined }
  },
  gstEnabled: boolean,
): number {
  const hasVal = (v: number | null | undefined) => v != null && Number(v) > 0
  if (levels.subVariant && hasVal(levels.subVariant.inclusive)) {
    return pickUnitPrice(levels.subVariant, gstEnabled)
  }
  if (levels.variant && hasVal(levels.variant.inclusive)) {
    return pickUnitPrice(levels.variant, gstEnabled)
  }
  return pickUnitPrice(levels.product, gstEnabled)
}
