// Selling-unit → piece conversion for order lines (stock is always tracked in pieces).

/** SQL: pieces per selling unit for an order_items row (NULL when it is not a count unit). */
export function orderItemFactorSql(oi = 'oi'): string {
  return `COALESCE(${oi}.sold_unit_factor, (
    SELECT pu.factor FROM product_units pu
    WHERE pu.product_id = ${oi}.product_id AND pu.dimension = 'count'
      AND lower(pu.unit) = lower(COALESCE(NULLIF(${oi}.buy_unit, 'unit'), ${oi}.sold_unit))
      AND (pu.variant_id = ${oi}.variant_id OR pu.variant_id IS NULL)
    ORDER BY pu.variant_id NULLS LAST LIMIT 1))`
}

/** SQL: the selling-unit name for an order_items row. */
export function orderItemUnitSql(oi = 'oi'): string {
  return `COALESCE(NULLIF(${oi}.buy_unit, 'unit'), ${oi}.sold_unit)`
}

export interface UnitConversion {
  /** e.g. "1 SET = 10 PCS" */
  perUnit: string
  /** e.g. "20 PCS" */
  total: string
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''))

export function unitConversion(
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
  factor: number | string | null | undefined
): UnitConversion | null {
  const f = Number(factor)
  const q = Number(quantity)
  if (!unit || !Number.isFinite(f) || f <= 1 || !Number.isFinite(q)) return null
  const u = unit.toUpperCase()
  if (u === 'PC' || u === 'PCS' || u === 'PIECE' || u === 'NOS') return null
  return { perUnit: `1 ${u} = ${fmt(f)} PCS`, total: `${fmt(q * f)} PCS` }
}
