// Display helpers that strip IEEE-754 noise (e.g. 999.9999679999 → 1000) from computed numbers.

/** Round a fractional quantity (weight/length/area) to 3 decimals. */
export function round3(n: number): number {
  return parseFloat(n.toFixed(3))
}

/**
 * Controlled-input value for money: computed numbers are rounded to paise, typed strings pass
 * through untouched so partial input like "10." keeps working.
 */
export function moneyInputValue(v: string | number | null | undefined): string | number {
  if (typeof v === 'number') return Number.isFinite(v) ? parseFloat(v.toFixed(2)) : ''
  return v ?? ''
}

/** Controlled-input value for quantities: numbers rounded to 3dp, strings untouched. */
export function qtyInputValue(v: string | number | null | undefined): string | number {
  if (typeof v === 'number') return Number.isFinite(v) ? round3(v) : ''
  return v ?? ''
}

/** Quantity as text: up to 3 decimals, trailing zeros dropped ("2.500" → "2.5", "3.000" → "3"). */
export function fmtQty(n: number | string | null | undefined): string {
  if (n == null || n === '') return ''
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  return String(round3(v))
}
