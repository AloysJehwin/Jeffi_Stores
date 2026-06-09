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
