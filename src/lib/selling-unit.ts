/**
 * Selling-unit helpers: quantity validation and base-unit conversion.
 *
 * A product's sellable unit is described by a `product_units` row:
 *   - `dimension`: 'count' | 'length' | 'area' | 'volume' | 'weight' | 'custom'
 *   - `factor`: base units per selling unit (a "box" of 12 has factor 12)
 *   - `qty_step`, `min_qty`, `max_qty`: purchase-quantity constraints
 *
 * These were previously enforced only in the storefront UI. This module makes
 * them a server-side contract so no crafted request can submit an arbitrary
 * quantity — which the serialized-product flow relies on (1 serial = 1 qty_step).
 */

export interface SellingUnit {
  unit: string
  factor: number
  dimension: string
  qty_step: number
  min_qty: number
  max_qty: number | null
}

/** Float tolerance for fractional selling units (e.g. 2.5 metres). */
const EPS = 1e-6

/** Coerce a possibly-string numeric DB value to a finite number, or fallback. */
function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

/**
 * Normalize a raw product_units row (string numerics from pg) into a SellingUnit.
 * Returns null when there is no unit row (product sold as plain integer units).
 */
export function toSellingUnit(row: {
  unit?: string | null
  factor?: unknown
  dimension?: string | null
  qty_step?: unknown
  min_qty?: unknown
  max_qty?: unknown
} | null | undefined): SellingUnit | null {
  if (!row || !row.unit) return null
  return {
    unit: row.unit,
    factor: num(row.factor, 1) || 1,
    dimension: row.dimension || 'count',
    qty_step: num(row.qty_step, 1) || 1,
    min_qty: num(row.min_qty, 0),
    max_qty: row.max_qty == null ? null : num(row.max_qty),
  }
}

/**
 * Base-unit quantity to decrement from stock for an ordered quantity.
 * Count-dimension units multiply by factor (a box of 12 → 12 pieces);
 * measured dimensions (length/area/volume/weight) pass through unchanged —
 * the ordered quantity already IS the measured amount (2.5 m stays 2.5).
 */
export function toBaseQuantity(qty: number, unit: SellingUnit | null): number {
  if (unit && unit.dimension === 'count') return qty * unit.factor
  return qty
}

/** True when `qty` is a positive multiple of `step` within float tolerance. */
export function isStepMultiple(qty: number, step: number): boolean {
  if (step <= 0) return true
  const ratio = qty / step
  return Math.abs(ratio - Math.round(ratio)) < EPS
}

export interface QtyValidationResult {
  ok: boolean
  /** User-facing reason when ok === false. */
  reason?: string
}

/**
 * Validate an ordered quantity against its selling unit's constraints.
 * Passing unit === null (plain integer-unit product) still enforces qty > 0
 * and integer quantity.
 */
export function validatePurchaseQuantity(qty: number, unit: SellingUnit | null): QtyValidationResult {
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: 'Quantity must be greater than zero.' }
  }

  if (!unit) {
    // No selling unit → plain product sold in whole pieces.
    if (Math.abs(qty - Math.round(qty)) > EPS) {
      return { ok: false, reason: 'Quantity must be a whole number.' }
    }
    return { ok: true }
  }

  if (qty < unit.min_qty - EPS) {
    return { ok: false, reason: `Minimum quantity is ${unit.min_qty} ${unit.unit}.` }
  }
  if (unit.max_qty != null && qty > unit.max_qty + EPS) {
    return { ok: false, reason: `Maximum quantity is ${unit.max_qty} ${unit.unit}.` }
  }
  if (!isStepMultiple(qty, unit.qty_step)) {
    return { ok: false, reason: `Quantity must be in multiples of ${unit.qty_step} ${unit.unit}.` }
  }
  return { ok: true }
}

/**
 * How many serial numbers a serialized-product sale consumes: one serial per
 * qty_step of BASE quantity — i.e. round(baseQty / qty_step).
 *
 * This is the single serial-count rule used on both sides of inventory:
 *   - sale: consuming `qty` selling units → round(baseQty / qty_step) serials
 *   - intake (PO receive): receiving `baseQty` base units → the same count
 * so serial rows and batch quantities stay in lockstep.
 *
 * baseQty already folds in the selling-unit factor (a box of 12 → 12 base
 * units); dividing by qty_step then splits each base unit into step-sized
 * serialisable slots. Examples:
 *   - "Small wire" 400 m base, qty_step 0.5 → 800 serials (one per half-metre)
 *   - "Earth bit cover" 100 base, qty_step 1  → 100 serials (unchanged)
 * With qty_step enforced as a hard purchase constraint, baseQty / qty_step is
 * always integral, so a serial is never partially consumed.
 */
export function serialCountForQuantity(qty: number, unit: SellingUnit | null): number {
  const base = toBaseQuantity(qty, unit)
  const step = unit && unit.qty_step > 0 ? unit.qty_step : 1
  return Math.round(base / step)
}

/**
 * Product-setup guardrail: a serialized product's selling unit must have a
 * whole-number qty_step, so that every valid purchase quantity (a multiple of
 * qty_step) maps to a whole number of serials. A fractional step (e.g. 2.5)
 * would let a valid quantity consume a fractional serial, which is impossible.
 * Returns an error reason when invalid, or null when OK.
 */
export function validateSerializedUnitStep(qtyStep: number): string | null {
  if (!Number.isFinite(qtyStep) || qtyStep <= 0) {
    return 'qty_step must be a positive number.'
  }
  if (Math.abs(qtyStep - Math.round(qtyStep)) > EPS) {
    return 'Serialized products need a whole-number qty_step so each step maps to one serial.'
  }
  return null
}
