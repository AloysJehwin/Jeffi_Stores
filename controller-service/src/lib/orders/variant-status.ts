import type { PoolClient } from 'pg'
import { withTransaction } from '@/lib/shared/db'

// An open draft carries its own copy of each row's is_active and the publisher writes it back,
// so a status flipped here is mirrored into the draft or the next publish would undo it.
async function patchDraft(
  client: PoolClient,
  column: 'variants' | 'sub_variants',
  productId: string,
  rowId: string,
  active: boolean
) {
  await client.query(
    `UPDATE product_drafts
        SET ${column} = (
              SELECT COALESCE(jsonb_agg(
                       CASE WHEN e->>'id' = $2 THEN jsonb_set(e, '{is_active}', to_jsonb($3::boolean)) ELSE e END
                       ORDER BY ord), '[]'::jsonb)
                FROM jsonb_array_elements(${column}) WITH ORDINALITY AS t(e, ord)
            ),
            updated_at = NOW()
      WHERE product_id = $1 AND jsonb_typeof(${column}) = 'array' AND jsonb_array_length(${column}) > 0`,
    [productId, rowId, active]
  )
}

export async function setVariantActive(productId: string, variantId: string, active: boolean): Promise<boolean> {
  return withTransaction(async client => {
    const res = await client.query(
      `UPDATE product_variants SET is_active = $1, updated_at = NOW() WHERE id = $2 AND product_id = $3 RETURNING id`,
      [active, variantId, productId]
    )
    if (!res.rows[0]) return false
    await patchDraft(client, 'variants', productId, variantId, active)
    return true
  })
}

export async function setSubVariantActive(
  productId: string,
  variantId: string,
  subVariantId: string,
  active: boolean
): Promise<boolean> {
  return withTransaction(async client => {
    const res = await client.query(
      `UPDATE product_sub_variants SET is_active = $1, updated_at = NOW()
        WHERE id = $2 AND variant_id = $3 AND product_id = $4 RETURNING id`,
      [active, subVariantId, variantId, productId]
    )
    if (!res.rows[0]) return false
    await patchDraft(client, 'sub_variants', productId, subVariantId, active)
    return true
  })
}
