import { withTransaction } from '@/lib/db'
import { PoolClient } from 'pg'

/**
 * Generate a race-safe product SKU using a transaction with row-level locking.
 * Format: {PREFIX}-{SEQUENCE} e.g. BOLT-001, NUT-042
 *
 * The prefix comes from categories.sku_prefix (admin-configurable),
 * falling back to the first 3 letters of the category name, then 'PRD'.
 */
export async function generateProductSku(categoryId: string | null): Promise<string> {
  return withTransaction(async (client: PoolClient) => {
    let prefix = 'PRD'

    if (categoryId) {
      // Lock the category row to serialize SKU generation for this category
      const catResult = await client.query(
        'SELECT name, sku_prefix FROM categories WHERE id = $1 FOR UPDATE',
        [categoryId]
      )
      const cat = catResult.rows[0]
      if (cat) {
        prefix = cat.sku_prefix
          || cat.name.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, '')
          || 'PRD'
      }
    }

    // Find the highest existing sequence number for this prefix
    const maxResult = await client.query(
      `SELECT MAX(
        CAST(NULLIF(SUBSTRING(sku FROM $1), '') AS INTEGER)
      ) AS max_seq
      FROM products
      WHERE sku ~ $2`,
      [
        `^${prefix}-(\\d+)$`,  // capture group for the number
        `^${prefix}-\\d+$`,    // match pattern
      ]
    )

    const nextSeq = (maxResult.rows[0]?.max_seq || 0) + 1
    return `${prefix}-${String(nextSeq).padStart(3, '0')}`
  })
}

/**
 * Generate a variant SKU from the product SKU and variant name.
 * Format: {PRODUCT_SKU}-{VARIANT_NAME_CLEANED}
 * e.g. BOLT-001-M6X30, NUT-042-10MM
 */
export function generateVariantSku(productSku: string, variantName: string): string {
  const suffix = variantName.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `${productSku}-${suffix}`
}
