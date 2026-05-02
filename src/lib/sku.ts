import { withTransaction } from '@/lib/db'
import { PoolClient } from 'pg'

export async function generateProductSku(categoryId: string | null): Promise<string> {
  return withTransaction(async (client: PoolClient) => {
    let prefix = 'PRD'

    if (categoryId) {
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

    prefix = prefix.toUpperCase()

    const maxResult = await client.query(
      `SELECT MAX(
        CAST(NULLIF(SUBSTRING(sku FROM length($1) + 2), '') AS INTEGER)
      ) AS max_seq
      FROM products
      WHERE sku ~ $2`,
      [
        prefix,
        `^${prefix}-\\d+$`,
      ]
    )

    const nextSeq = (maxResult.rows[0]?.max_seq || 0) + 1
    return `${prefix}-${String(nextSeq).padStart(3, '0')}`.toUpperCase()
  })
}

export function generateVariantSku(productSku: string, variantName: string): string {
  const suffix = variantName.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `${productSku}-${suffix}`
}
