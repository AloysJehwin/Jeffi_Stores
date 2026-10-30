import { queryOne, queryMany } from '@/lib/shared/db'

// Digital products are single-SKU: no variants/sub-variants/units, and not sellable offline.

export async function isDigitalProduct(productId: string): Promise<boolean> {
  const row = await queryOne<{ is_digital: boolean }>(`SELECT is_digital FROM products WHERE id = $1`, [productId])
  return !!row?.is_digital
}

// Vault uploads: live digital, or being edited as a draft (the toggle may not be published yet).
export async function canHoldVaultFiles(productId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT (p.is_digital OR EXISTS (SELECT 1 FROM product_drafts d WHERE d.product_id = p.id)) AS ok
       FROM products p WHERE p.id = $1`,
    [productId]
  )
  return !!row?.ok
}

// Return the subset of productIds that are digital. Empty input → empty array (no query).
export async function findDigitalProductIds(productIds: string[]): Promise<string[]> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (!ids.length) return []
  const rows = await queryMany<{ id: string }>(
    `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND is_digital = true`,
    [ids]
  )
  return rows.map(r => r.id)
}
