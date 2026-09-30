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
export function toSellingUnit(
  row:
    | {
        unit?: string | null
        factor?: unknown
        dimension?: string | null
        qty_step?: unknown
        min_qty?: unknown
        max_qty?: unknown
      }
    | null
    | undefined
): SellingUnit | null {
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
  return serialCountForBaseQuantity(toBaseQuantity(qty, unit), unit)
}

/**
 * Same rule as `serialCountForQuantity`, for callers that already hold a BASE
 * quantity (batch rows, order_items.base_quantity) and must not re-apply the
 * factor. Use this rather than dividing by qty_step by hand.
 */
export function serialCountForBaseQuantity(baseQty: number, unit: SellingUnit | null): number {
  const step = unit && unit.qty_step > 0 ? unit.qty_step : 1
  return Math.round(baseQty / step)
}

/**
 * Serial slots that fit ENTIRELY within `baseQty`, plus the base units left
 * over. Intake at a grain whose stock is not a whole multiple of qty_step
 * cannot label the remainder, so bootstrap floors the count and writes the
 * remainder off: 88 base units at step 10 → 8 serials, 8 units unlabelled.
 */
export function serialSlotsForBaseQuantity(
  baseQty: number,
  unit: SellingUnit | null
): { serials: number; covered: number; remainder: number } {
  const step = unit && unit.qty_step > 0 ? unit.qty_step : 1
  const serials = Math.max(0, Math.floor(baseQty / step + EPS))
  const covered = serials * step
  return { serials, covered, remainder: Math.max(0, baseQty - covered) }
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

/**
 * Product-setup guardrail on the qty_step / min_qty / max_qty triple.
 *
 * Every orderable quantity must be a multiple of qty_step, so the bounds must
 * be reachable multiples too. min_qty 1 with qty_step 10 advertises a minimum
 * nobody can order — the first valid quantity is 10 — and min_qty 13 with
 * qty_step 10 is unreachable in both directions. Returns null when valid.
 */
export function validateUnitQuantityBounds(u: {
  qty_step: number
  min_qty: number
  max_qty?: number | null
}): string | null {
  const step = u.qty_step
  if (!Number.isFinite(step) || step <= 0) return 'qty_step must be a positive number.'

  if (!Number.isFinite(u.min_qty) || u.min_qty <= 0) {
    return 'Minimum quantity must be greater than zero.'
  }
  if (u.min_qty < step - EPS) {
    return `Minimum quantity (${u.min_qty}) cannot be below the quantity step (${step}) — the smallest orderable quantity is ${step}.`
  }
  if (!isStepMultiple(u.min_qty, step)) {
    return `Minimum quantity (${u.min_qty}) must be a multiple of the quantity step (${step}).`
  }

  if (u.max_qty != null) {
    if (u.max_qty < u.min_qty - EPS) {
      return `Maximum quantity (${u.max_qty}) cannot be below the minimum quantity (${u.min_qty}).`
    }
    if (!isStepMultiple(u.max_qty, step)) {
      return `Maximum quantity (${u.max_qty}) must be a multiple of the quantity step (${step}).`
    }
  }
  return null
}

/** Minimal query surface satisfied by both a PoolClient and the db `query` helper. */
export interface UnitGuardRunner {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>
}

/** Which load-bearing fields a unit write is trying to change. */
export interface UnitChangeIntent {
  factor?: boolean
  dimension?: boolean
  qtyStep?: boolean
  /** The whole unit row is being removed. */
  remove?: boolean
}

export interface UnitGuardScope {
  productId: string
  variantId?: string | null
  subVariantId?: string | null
  /** Label used in the error message (unit name, or the grain's name). */
  label?: string
}

/**
 * The base unit in force at a grain, resolved MOST SPECIFIC FIRST:
 * sub-variant, then variant, then product. Every intake and sale path must use
 * this so the serial-count rule (base / qty_step) agrees across them.
 */
export async function resolveGrainUnit(
  runner: UnitGuardRunner,
  scope: { productId: string; variantId?: string | null; subVariantId?: string | null }
): Promise<SellingUnit | null> {
  const res = await runner.query(
    `SELECT unit, factor::text AS factor, dimension,
            qty_step::text AS qty_step, min_qty::text AS min_qty, max_qty::text AS max_qty
       FROM product_units
      WHERE product_id = $1 AND is_base = true
        AND ( ($3::uuid IS NOT NULL AND sub_variant_id = $3::uuid)
              OR (sub_variant_id IS NULL AND variant_id = $2)
              OR (sub_variant_id IS NULL AND variant_id IS NULL) )
      ORDER BY sub_variant_id NULLS LAST, variant_id NULLS LAST
      LIMIT 1`,
    [scope.productId, scope.variantId ?? null, scope.subVariantId ?? null]
  )
  return toSellingUnit(res.rows[0])
}

/**
 * Which meaning-bearing fields an update actually changes, comparing the request
 * body against the unit's current values. A PATCH that re-sends the same factor
 * is not a change and must not be refused.
 */
export function changedUnitFields(
  body: { factor?: unknown; dimension?: unknown; qty_step?: unknown },
  current: { factor?: unknown; dimension?: unknown; qty_step?: unknown } | null | undefined
): UnitChangeIntent {
  const numChanged = (next: unknown, cur: unknown) => {
    if (next === undefined) return false
    const a = num(next, NaN)
    const b = num(cur, NaN)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true
    return Math.abs(a - b) > EPS
  }
  return {
    factor: numChanged(body.factor, current?.factor),
    qtyStep: numChanged(body.qty_step, current?.qty_step),
    dimension: body.dimension !== undefined && String(body.dimension) !== String(current?.dimension ?? ''),
  }
}

/**
 * Guard a selling-unit write against stock that was already recorded under the
 * CURRENT unit definition.
 *
 * Batches and serials store bare numbers — neither table records the unit it was
 * written under, so the live `product_units` row is what gives them meaning:
 *
 *   - SERIALIZED: a serial row's meaning was fixed at receive time by the then
 *     current `qty_step` (serials = baseQty / qty_step). It cannot be re-derived,
 *     so any change to factor/dimension/qty_step — or removing the unit — is
 *     refused while serials are in stock.
 *   - PERISHABLE: batches hold BASE units, which stay correct when `factor`
 *     changes; only what a future sale consumes moves, which is the intent. So
 *     `factor` and `qty_step` stay editable and only `dimension` is refused.
 *
 * `dimension` is refused in both modes because toBaseQuantity() multiplies by
 * factor for 'count' and passes through for measured dimensions — flipping it
 * redefines every stored quantity without touching a row.
 *
 * Returns a user-facing reason when the write must be refused, else null.
 */
export async function assertUnitChangeAllowed(
  runner: UnitGuardRunner,
  scope: UnitGuardScope,
  changing: UnitChangeIntent
): Promise<string | null> {
  const touchesMeaning = !!(changing.factor || changing.dimension || changing.qtyStep || changing.remove)
  if (!touchesMeaning) return null

  const flags = await runner.query(`SELECT perishable, serialized FROM products WHERE id = $1`, [scope.productId])
  const perishable = !!flags.rows[0]?.perishable
  const serialized = !!flags.rows[0]?.serialized
  if (!perishable && !serialized) return null

  const variantId = scope.variantId ?? null
  const subVariantId = scope.subVariantId ?? null
  const what = scope.label ? `"${scope.label}"` : 'this product'

  if (serialized) {
    const serials = await runner.query(
      `SELECT COUNT(*)::int AS n FROM product_serials
        WHERE product_id = $1
          AND (variant_id = $2 OR ($2::uuid IS NULL AND variant_id IS NULL))
          AND (sub_variant_id = $3 OR ($3::uuid IS NULL AND sub_variant_id IS NULL))
          AND status = 'in_stock'`,
      [scope.productId, variantId, subVariantId]
    )
    const n = Number(serials.rows[0]?.n ?? 0)
    if (n > 0) {
      const action = changing.remove ? 'remove the selling unit' : 'change the selling unit'
      return (
        `Cannot ${action} for ${what} — ${n} serial number${n === 1 ? ' is' : 's are'} in stock. ` +
        `Each serial was recorded against the current unit, so the mapping cannot be recalculated. ` +
        `Sell or remove the serials first.`
      )
    }
  }

  if (perishable && changing.dimension) {
    const batches = await runner.query(
      `SELECT COUNT(*)::int AS n FROM product_batches
        WHERE product_id = $1
          AND (variant_id = $2 OR ($2::uuid IS NULL AND variant_id IS NULL))
          AND (sub_variant_id = $3 OR ($3::uuid IS NULL AND sub_variant_id IS NULL))
          AND quantity_remaining > 0`,
      [scope.productId, variantId, subVariantId]
    )
    const n = Number(batches.rows[0]?.n ?? 0)
    if (n > 0) {
      return (
        `Cannot change the unit dimension for ${what} — ${n} batch${n === 1 ? '' : 'es'} still hold stock. ` +
        `Dimension decides whether the factor applies, so changing it would reinterpret every existing lot. ` +
        `Consume or remove those batches first.`
      )
    }
  }

  return null
}

/* ────────────────────────────────────────────────────────────────────────────
 * Lot / serial identifiers
 *
 * Printed on labels, so fixed-width and short: a 4-char product prefix + an
 * 8-char body = 12 characters, no separators.
 *
 * Body = 5-char base36 timestamp (minutes since 2020, ~100 years of range)
 * + 3-char base36 tail. When generating a run, the tail is a SEQUENCE, not
 * random, so a batch of N ids is collision-free by construction (36^3 = 46656
 * per minute). A lone id uses a random tail.
 *
 * Uniqueness is still enforced by the DB (uniq_product_serials_instock*) and
 * the capture UI rejects duplicates before submit.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 4-char prefix from a SKU — letters/digits only, padded so width is constant. */
export function idPrefix(sku?: string | null): string {
  const clean = String(sku ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (!clean) return 'GEN0'
  return (clean.slice(0, 4) + '0000').slice(0, 4)
}

/** Minutes since 2020-01-01, base36, 5 chars (wraps after ~115 years). */
function stampBase36(at: Date): string {
  const EPOCH_2020 = Date.UTC(2020, 0, 1)
  const minutes = Math.max(0, Math.floor((at.getTime() - EPOCH_2020) / 60000))
  return minutes.toString(36).toUpperCase().padStart(5, '0').slice(-5)
}

function tailBase36(n: number): string {
  return Math.abs(Math.floor(n)).toString(36).toUpperCase().padStart(3, '0').slice(-3)
}

function randomTail(): string {
  return tailBase36(Math.floor(Math.random() * 46656))
}

/**
 * A 12-character id: 4-char product prefix + 5-char timestamp + 3-char tail.
 * e.g. TAPH1B7K3QF
 */
function buildId(sku: string | null | undefined, at: Date, seq?: number): string {
  return `${idPrefix(sku)}${stampBase36(at)}${seq == null ? randomTail() : tailBase36(seq)}`
}

/** One serial number. Pass `seq` when generating a run to avoid collisions. */
export function generateSerialNumber(sku?: string | null, seq?: number, at: Date = new Date()): string {
  return buildId(sku, at, seq)
}

/** One lot number — same 12-char shape, so both fit the same label slot. */
export function generateLotNumber(sku?: string | null, at: Date = new Date()): string {
  return buildId(sku, at)
}

/**
 * `count` serials in one go. The sequential tail makes the run collision-free,
 * which random tails cannot guarantee when generating hundreds at once.
 */
export function generateSerialRun(sku: string | null | undefined, count: number): string[] {
  const at = new Date()
  const offset = Math.floor(Math.random() * 46656)
  return Array.from({ length: Math.max(0, count) }, (_, i) => generateSerialNumber(sku, (offset + i) % 46656, at))
}
