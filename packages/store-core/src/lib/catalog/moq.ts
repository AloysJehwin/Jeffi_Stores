// Minimum order quantity (products.moq), in base pieces. Applies to business (B2B) buyers only.

/** Error when a line of `qty` selling units (each `factor` pieces) is below the MOQ; null when fine. */
export function moqError(moq: unknown, qty: number, unit?: { factor?: number | null; dimension?: string | null } | null): string | null {
  const min = Number(moq)
  if (!(min > 1) || !(qty > 0)) return null
  // Weight / length / volume units are sold by measure; a piece count does not apply.
  if (unit?.dimension && unit.dimension !== 'count') return null
  const factor = Number(unit?.factor) > 0 ? Number(unit!.factor) : 1
  if (qty * factor + 1e-9 >= min) return null
  const units = Math.ceil(min / factor)
  return factor > 1 ? `Minimum order for business buyers is ${min} pieces (${units} packs).` : `Minimum order for business buyers is ${min} pieces.`
}
