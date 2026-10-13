import { queryMany } from '@/lib/shared/db'

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
  if (!productIds.length) return lines.map(() => 1)
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
    return row && (row.dimension ?? 'count') === 'count' && f > 0 ? f : 1
  })
}
