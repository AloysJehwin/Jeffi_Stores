import { queryMany } from '@/lib/shared/db'
import type { SellingUnit } from './selling-unit'

export interface UnitLineRef {
  productId?: string | null
  variantId?: string | null
  subVariantId?: string | null
  /** The selling unit bought in; omitted → the default (is_base) unit, which is what storefront orders use. */
  unit?: string | null
}

/**
 * Pieces per selling unit for each line (a "set of 10" → 10). Weight, dimensions and stock are per piece, so
 * anything physical multiplies by this. Most specific scope wins (sub-variant → variant → product); only
 * count units convert — length/weight units and unknown lines are 1.
 */
export async function piecesPerUnit(input: UnitLineRef[]): Promise<number[]> {
  return (await sellingUnitsFor(input)).map(u => u.factor)
}

/** The resolved selling unit per line: its name (null when none is configured) and pieces per unit. */
export async function sellingUnitsFor(input: UnitLineRef[]): Promise<{ unit: string | null; factor: number }[]> {
  // Callers sometimes send only the variant/sub-variant id.
  const orphanV = input.filter(l => !l.productId && l.variantId).map(l => l.variantId!)
  const orphanS = input.filter(l => !l.productId && !l.variantId && l.subVariantId).map(l => l.subVariantId!)
  const owners = orphanV.length || orphanS.length
    ? await queryMany<{ id: string; product_id: string }>(
        `SELECT id, product_id FROM product_variants WHERE id = ANY($1::uuid[])
         UNION ALL SELECT id, product_id FROM product_sub_variants WHERE id = ANY($2::uuid[])`,
        [orphanV, orphanS]
      ).catch(() => [])
    : []
  const lines = input.map(l => l.productId ? l : { ...l, productId: owners.find(o => o.id === (l.variantId || l.subVariantId))?.product_id ?? null })
  const productIds = [...new Set(lines.map(l => l.productId).filter(Boolean))] as string[]
  if (!productIds.length) return lines.map(() => ({ unit: null, factor: 1 }))
  const rows = await queryMany<{
    product_id: string; variant_id: string | null; sub_variant_id: string | null
    unit: string; factor: string | number; is_base: boolean; dimension: string | null
  }>(
    `SELECT product_id, variant_id, sub_variant_id, unit, factor, is_base, dimension
       FROM product_units WHERE product_id = ANY($1::uuid[])`,
    [productIds]
  ).catch(() => [])
  return lines.map(l => {
    const scoped = rows.filter(r => r.product_id === l.productId)
    const pick = (match: (r: (typeof rows)[number]) => boolean) =>
      (l.subVariantId && scoped.find(r => r.sub_variant_id === l.subVariantId && match(r))) ||
      (l.variantId && scoped.find(r => !r.sub_variant_id && r.variant_id === l.variantId && match(r))) ||
      scoped.find(r => !r.sub_variant_id && !r.variant_id && match(r))
    const want = l.unit?.trim().toLowerCase()
    const row = (want && pick(r => r.unit.toLowerCase() === want)) || pick(r => r.is_base)
    const f = Number(row?.factor)
    return { unit: row?.unit ?? null, factor: row && (row.dimension ?? 'count') === 'count' && f > 0 ? f : 1 }
  })
}

interface ChainRow {
  variant_id: string | null
  sub_variant_id: string | null
  unit: string
  is_base: boolean
}

/**
 * Every unit a document line can be sold in, from a product's product_units rows: sub-variant, then variant,
 * then product, one per unit name with the most specific scope winning. The default (is_base of the most
 * specific scope that has units) comes first and is the only one flagged is_base.
 */
export function resolveUnitChain<T extends ChainRow>(
  rows: T[],
  variantId?: string | null,
  subVariantId?: string | null
): (T & { is_base: boolean })[] {
  const depth = (r: ChainRow) => (r.sub_variant_id ? 0 : r.variant_id ? 1 : 2)
  const inScope = rows.filter(r =>
    r.sub_variant_id ? r.sub_variant_id === subVariantId : r.variant_id ? r.variant_id === variantId : true
  )
  inScope.sort((a, b) => depth(a) - depth(b) || Number(b.is_base) - Number(a.is_base) || a.unit.localeCompare(b.unit))
  const seen = new Set<string>()
  const units = inScope.filter(r => !seen.has(r.unit.toLowerCase()) && seen.add(r.unit.toLowerCase()))
  const def = units.find(u => u.is_base && depth(u) === depth(units[0] ?? u)) ?? units.find(u => u.is_base)
  const ordered = def ? [def, ...units.filter(u => u !== def)] : units
  return ordered.map(u => ({ ...u, is_base: u === def }))
}

export interface LineUnit {
  unit: string
  label: string
  /** Pieces per unit (count units); measured units keep their factor but don't multiply quantities. */
  factor: number
  dimension: string
  minQty: number
  maxQty: number | null
  qtyStep: number
  isDefault: boolean
}

/** resolveUnitChain for many lines in one query, shaped for agents and APIs. */
export async function unitChainsFor(
  lines: { productId: string; variantId?: string | null; subVariantId?: string | null }[]
): Promise<LineUnit[][]> {
  const productIds = [...new Set(lines.map(l => l.productId).filter(Boolean))]
  if (!productIds.length) return lines.map(() => [])
  const rows = await queryMany<{
    product_id: string
    variant_id: string | null
    sub_variant_id: string | null
    unit: string
    display_label: string | null
    factor: string
    dimension: string | null
    is_base: boolean
    min_qty: string
    max_qty: string | null
    qty_step: string
  }>(
    `SELECT product_id::text, variant_id::text, sub_variant_id::text, unit, display_label, factor::text,
            dimension, is_base, min_qty::text, max_qty::text, qty_step::text
       FROM product_units WHERE product_id = ANY($1::uuid[])`,
    [productIds]
  )
  return lines.map(l =>
    resolveUnitChain(
      rows.filter(r => r.product_id === l.productId),
      l.variantId,
      l.subVariantId
    ).map(r => ({
      unit: r.unit,
      label: r.display_label || r.unit,
      factor: Number(r.factor) || 1,
      dimension: r.dimension || 'count',
      minQty: Number(r.min_qty) || 0,
      maxQty: r.max_qty == null ? null : Number(r.max_qty),
      qtyStep: Number(r.qty_step) || 1,
      isDefault: r.is_base,
    }))
  )
}

/** A LineUnit in the shape selling-unit.ts validates and converts. */
export function asSellingUnit(u: LineUnit): SellingUnit {
  return { unit: u.unit, factor: u.factor, dimension: u.dimension, qty_step: u.qtyStep, min_qty: u.minQty, max_qty: u.maxQty }
}
