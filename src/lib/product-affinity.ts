import { queryMany } from '@/lib/db'

/** Active products most often ordered together with any of `productIds`, strongest first. */
export async function frequentlyBoughtWith(productIds: string[], limit: number): Promise<string[]> {
  if (productIds.length === 0) return []
  const rows = await queryMany<{ product_id: string }>(
    `SELECT oi2.product_id
     FROM order_items oi1
     JOIN orders o ON o.id = oi1.order_id AND o.status <> 'cancelled'
     JOIN order_items oi2 ON oi2.order_id = oi1.order_id AND oi2.product_id <> ALL($1::uuid[])
     JOIN products p ON p.id = oi2.product_id AND p.is_active = true
     WHERE oi1.product_id = ANY($1::uuid[])
     GROUP BY oi2.product_id
     ORDER BY COUNT(DISTINCT oi2.order_id) DESC, oi2.product_id
     LIMIT $2`,
    [productIds, limit]
  )
  return rows.map(r => r.product_id)
}

// Viewers are signed-in users or anonymous sessions; the window keeps the scan bounded on the
// created_at index, since product_views has no session or user index.
export async function alsoViewedWith(productId: string, limit: number): Promise<string[]> {
  const rows = await queryMany<{ product_id: string }>(
    `WITH viewers AS (
       SELECT DISTINCT COALESCE(user_id::text, session_id) AS who
       FROM product_views
       WHERE product_id = $1 AND created_at > now() - interval '90 days'
         AND COALESCE(user_id::text, session_id) IS NOT NULL
       LIMIT 500
     )
     SELECT pv.product_id
     FROM product_views pv
     JOIN viewers v ON v.who = COALESCE(pv.user_id::text, pv.session_id)
     JOIN products p ON p.id = pv.product_id AND p.is_active = true
     WHERE pv.product_id <> $1 AND pv.created_at > now() - interval '90 days'
     GROUP BY pv.product_id
     ORDER BY COUNT(DISTINCT v.who) DESC, pv.product_id
     LIMIT $2`,
    [productId, limit]
  )
  return rows.map(r => r.product_id)
}
