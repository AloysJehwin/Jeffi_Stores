import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') || '30'), 1), 365)
  const productId = params.id

  const product = await queryOne<{ id: string; name: string; sku: string; slug: string; brand_name: string | null; stock_quantity: number; base_price: string }>(
    `SELECT p.id, p.name, p.sku, p.slug, b.name AS brand_name, p.stock_quantity, p.base_price
     FROM products p LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.id = $1`,
    [productId]
  )
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const [totals, daily, referrers, recentBuyers, variantStats, currentCarts] = await Promise.all([
    queryOne<{
      views: string; unique_viewers: string; cart_adds: string; orders: string; revenue: string; quantity_sold: string
    }>(`
      SELECT
        (SELECT COUNT(*) FROM product_views WHERE product_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2) AS views,
        (SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id)) FROM product_views WHERE product_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2) AS unique_viewers,
        (SELECT COUNT(*) FROM cart_items WHERE product_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2) AS cart_adds,
        (SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = $1 AND o.created_at >= NOW() - INTERVAL '1 day' * $2 AND o.payment_status = 'paid') AS orders,
        (SELECT COALESCE(SUM(oi.total_price), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = $1 AND o.created_at >= NOW() - INTERVAL '1 day' * $2 AND o.payment_status = 'paid') AS revenue,
        (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = $1 AND o.created_at >= NOW() - INTERVAL '1 day' * $2 AND o.payment_status = 'paid') AS quantity_sold
    `, [productId, days]),

    queryMany<{ date: string; views: string; carts: string; orders: string }>(`
      SELECT day::date AS date,
        COALESCE(v.views, 0) AS views,
        COALESCE(c.carts, 0) AS carts,
        COALESCE(o.orders, 0) AS orders
      FROM generate_series(
        (NOW() - INTERVAL '1 day' * $2)::date,
        NOW()::date,
        '1 day'
      ) day
      LEFT JOIN (
        SELECT DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS d, COUNT(*) AS views
        FROM product_views WHERE product_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
        GROUP BY d
      ) v ON v.d = day::date
      LEFT JOIN (
        SELECT DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS d, COUNT(*) AS carts
        FROM cart_items WHERE product_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
        GROUP BY d
      ) c ON c.d = day::date
      LEFT JOIN (
        SELECT DATE(o.created_at AT TIME ZONE 'Asia/Kolkata') AS d, COUNT(DISTINCT oi.order_id) AS orders
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = $1 AND o.created_at >= NOW() - INTERVAL '1 day' * $2 AND o.payment_status = 'paid'
        GROUP BY d
      ) o ON o.d = day::date
      ORDER BY day::date ASC
    `, [productId, days]),

    queryMany<{ referrer: string; sessions: string }>(`
      SELECT COALESCE(NULLIF(pe.referrer, ''), 'Direct') AS referrer,
             COUNT(DISTINCT pe.session_id) AS sessions
      FROM page_events pe
      WHERE pe.path LIKE $1
        AND pe.created_at >= NOW() - INTERVAL '1 day' * $2
      GROUP BY referrer
      ORDER BY sessions DESC
      LIMIT 8
    `, [`/products/${product.slug}%`, days]).catch(() => [] as { referrer: string; sessions: string }[]),

    queryMany<{ order_number: string; created_at: string; quantity: string; total_price: string; customer_name: string }>(`
      SELECT o.order_number, o.created_at, oi.quantity, oi.total_price, o.customer_name
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1 AND o.payment_status = 'paid'
      ORDER BY o.created_at DESC
      LIMIT 10
    `, [productId]),

    queryMany<{ variant_name: string | null; sub_variant_name: string | null; orders: string; quantity: string; revenue: string }>(`
      SELECT pv.variant_name,
             NULL AS sub_variant_name,
             COUNT(DISTINCT oi.order_id) AS orders,
             COALESCE(SUM(oi.quantity), 0) AS quantity,
             COALESCE(SUM(oi.total_price), 0) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.product_id = $1 AND o.payment_status = 'paid'
        AND o.created_at >= NOW() - INTERVAL '1 day' * $2
      GROUP BY pv.variant_name
      ORDER BY revenue DESC
      LIMIT 10
    `, [productId, days]),

    queryOne<{ active: string }>(`
      SELECT COUNT(*) AS active FROM cart_items
      WHERE product_id = $1 AND COALESCE(saved_for_later, FALSE) = FALSE
    `, [productId]),
  ])

  const views = parseInt(totals?.views ?? '0')
  const orders = parseInt(totals?.orders ?? '0')
  const cartAdds = parseInt(totals?.cart_adds ?? '0')

  return NextResponse.json({
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      slug: product.slug,
      brandName: product.brand_name,
      stock: product.stock_quantity,
      basePrice: parseFloat(product.base_price),
    },
    days,
    totals: {
      views,
      uniqueViewers: parseInt(totals?.unique_viewers ?? '0'),
      cartAdds,
      orders,
      revenue: parseFloat(totals?.revenue ?? '0'),
      quantitySold: parseFloat(totals?.quantity_sold ?? '0'),
      conversionRate: views > 0 ? Math.round((orders / views) * 1000) / 10 : 0,
      cartConversionRate: cartAdds > 0 ? Math.round((orders / cartAdds) * 1000) / 10 : 0,
      revenuePerView: views > 0 ? Math.round((parseFloat(totals?.revenue ?? '0') / views) * 100) / 100 : 0,
      activeCarts: parseInt(currentCarts?.active ?? '0'),
    },
    timeSeries: daily.map(r => ({
      date: r.date,
      views: parseInt(r.views),
      carts: parseInt(r.carts),
      orders: parseInt(r.orders),
    })),
    referrers: referrers.map(r => ({ referrer: r.referrer, sessions: parseInt(r.sessions) })),
    recentBuyers: recentBuyers.map(r => ({
      orderNumber: r.order_number,
      createdAt: r.created_at,
      quantity: parseFloat(r.quantity),
      total: parseFloat(r.total_price),
      customerName: r.customer_name,
    })),
    variantBreakdown: variantStats.map(r => ({
      variantName: r.variant_name,
      orders: parseInt(r.orders),
      quantity: parseFloat(r.quantity),
      revenue: parseFloat(r.revenue),
    })),
  })
}
