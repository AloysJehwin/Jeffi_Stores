import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    const [stats, recentOrders, defaultAddress, wishlistCount] = await Promise.all([
      queryOne<{ total_orders: number; total_spent: number; active_orders: number }>(
        `SELECT
          COUNT(*)::int AS total_orders,
          COALESCE(SUM(total_amount), 0)::numeric AS total_spent,
          COUNT(*) FILTER (WHERE status IN ('pending','confirmed','shipped','out_for_delivery'))::int AS active_orders
         FROM orders WHERE user_id = $1`,
        [userId]
      ),
      queryMany(
        `SELECT
          o.id, o.order_number, o.created_at, o.status, o.total_amount,
          COALESCE(
            (SELECT json_agg(
              json_build_object(
                'product_name', oi.product_name,
                'quantity', oi.quantity,
                'thumbnail_url', (
                  SELECT pi.thumbnail_url FROM product_images pi
                  WHERE pi.product_id = oi.product_id AND pi.is_primary = true
                  LIMIT 1
                )
              )
            ) FROM order_items oi WHERE oi.order_id = o.id),
            '[]'::json
          ) AS items
         FROM orders o
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC
         LIMIT 3`,
        [userId]
      ),
      queryOne(
        `SELECT full_name, address_line1, address_line2, landmark, city, state, postal_code, phone
         FROM addresses WHERE user_id = $1 AND is_default = true LIMIT 1`,
        [userId]
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM wishlist_items WHERE user_id = $1`,
        [userId]
      ),
    ])

    return NextResponse.json({
      stats: stats ?? { total_orders: 0, total_spent: 0, active_orders: 0 },
      recentOrders: recentOrders ?? [],
      defaultAddress: defaultAddress ?? null,
      wishlistCount: wishlistCount?.count ?? 0,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
