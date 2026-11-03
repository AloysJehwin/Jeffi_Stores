import { queryMany } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { buildProductCardSql } from '@/lib/catalog/homepage-data'
export { cardPropsFor, type CardProps } from '@/lib/catalog/product-card-props'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'

export const TOTAL_SOLD_SQL = `COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0)`

/** Card-ready product rows (the shape productCardProps expects). `where` may use $1..$n from `params`. */
export async function getProductCards(opts: {
  where: string
  orderBy: string
  params?: unknown[]
  limit: number
  gstEnabled?: boolean
}): Promise<any[]> {
  const params = opts.params ?? []
  const gstEnabled = opts.gstEnabled ?? (await getFeatureFlags()).gstEnabled
  const sql = buildProductCardSql(
    { where: opts.where, orderBy: opts.orderBy, limit: `$${params.length + 1}` },
    {
      minPriceSql: gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL,
      variantStockTotalSql: VARIANT_STOCK_TOTAL_SQL,
      variantMinMrpSql: VARIANT_MIN_MRP_SQL,
      totalSoldSql: TOTAL_SOLD_SQL,
    }
  )
  return queryMany(sql, [...params, opts.limit])
}

/** Active products for these ids, card-ready, in the order the ids were given. */
export async function getProductCardsByIds(ids: string[], gstEnabled?: boolean): Promise<any[]> {
  if (ids.length === 0) return []
  const rows = await getProductCards({
    where: 'p.is_active = true AND p.id = ANY($1::uuid[])',
    orderBy: 'p.created_at DESC',
    params: [ids],
    limit: ids.length,
    gstEnabled,
  })
  const byId = new Map(rows.map(r => [r.id as string, r]))
  return ids.map(id => byId.get(id)).filter(Boolean)
}
