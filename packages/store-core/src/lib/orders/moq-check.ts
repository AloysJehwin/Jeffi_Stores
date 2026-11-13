import { queryMany } from '@/lib/shared/db'
import { moqError } from '@/lib/catalog/moq'

// Server-side MOQ checks for business checkouts (cart lines can predate a raised MOQ).

const UNIT_JOIN = (alias: string, product: string, unit: string, variant: string, subVariant: string) => `
  LEFT JOIN LATERAL (
    SELECT pu.factor::float AS factor, pu.dimension FROM product_units pu
     WHERE pu.product_id = ${product} AND pu.unit = ${unit}
       AND ((${subVariant} IS NOT NULL AND pu.sub_variant_id = ${subVariant})
            OR (pu.sub_variant_id IS NULL AND pu.variant_id IS NOT DISTINCT FROM ${variant})
            OR (pu.sub_variant_id IS NULL AND pu.variant_id IS NULL))
     ORDER BY pu.sub_variant_id NULLS LAST, pu.variant_id NULLS LAST
     LIMIT 1) ${alias} ON true`

type Line = { name: string; moq: number; qty: number; factor: number | null; dimension: string | null }

const firstProblem = (rows: Line[]) => {
  for (const r of rows) {
    const err = moqError(r.moq, Number(r.qty), { factor: r.factor, dimension: r.dimension })
    if (err) return `${r.name}: ${err}`
  }
  return null
}

/** The first cart line below its product's MOQ, as a message; null when every line is fine. */
export async function cartMoqProblem(userId: string): Promise<string | null> {
  const rows = await queryMany<Line>(
    `SELECT p.name, p.moq, ci.quantity::float AS qty, u.factor, u.dimension
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       ${UNIT_JOIN('u', 'ci.product_id', 'ci.buy_unit', 'ci.variant_id', 'ci.sub_variant_id')}
      WHERE ci.user_id = $1 AND COALESCE(ci.saved_for_later, FALSE) = FALSE AND p.moq > 1`,
    [userId]
  )
  return firstProblem(rows)
}

/** MOQ message for a Buy Now of `qty` × buyUnit, or null. */
export async function buyNowMoqProblem(i: { productId: string; variantId: string | null; subVariantId: string | null; qty: number; buyUnit: string | null }): Promise<string | null> {
  const rows = await queryMany<Line>(
    `SELECT p.name, p.moq, $2::float AS qty, u.factor, u.dimension
       FROM products p
       ${UNIT_JOIN('u', 'p.id', '$3::text', '$4::uuid', '$5::uuid')}
      WHERE p.id = $1 AND p.moq > 1`,
    [i.productId, i.qty, i.buyUnit, i.variantId, i.subVariantId]
  )
  return firstProblem(rows)
}
