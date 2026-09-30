import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'dashboard:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7'), 1), 90)

  const [
    funnel,
    topPages,
    topReferrers,
    dailySessions,
    devices,
    browsers,
    hourly,
    sessionDepths,
    topProducts,
    conversionLaggards,
    topSearchTerms,
    noResultSearches,
  ] = await Promise.all([
    queryMany<{ page: string; sessions: string; users: string }>(
      `
      SELECT
        page,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(DISTINCT user_id)    AS users
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND page IN ('home','categories','category','product','cart','checkout','order_placed')
      GROUP BY page
    `,
      [days]
    ),

    queryMany<{ path: string; hits: string; sessions: string }>(
      `
      SELECT path, COUNT(*) AS hits, COUNT(DISTINCT session_id) AS sessions
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY path
      ORDER BY hits DESC
      LIMIT 15
    `,
      [days]
    ),

    queryMany<{ referrer: string; sessions: string }>(
      `
      SELECT
        COALESCE(NULLIF(referrer, ''), 'Direct') AS referrer,
        COUNT(DISTINCT session_id) AS sessions
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY referrer
      ORDER BY sessions DESC
      LIMIT 10
    `,
      [days]
    ),

    queryMany<{ date: string; sessions: string; pageviews: string }>(
      `
      SELECT
        DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS date,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) AS pageviews
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY DATE(created_at AT TIME ZONE 'Asia/Kolkata')
      ORDER BY date ASC
    `,
      [days]
    ),

    queryMany<{ type: string; sessions: string }>(
      `
      SELECT
        CASE
          WHEN user_agent ILIKE '%mobile%' OR user_agent ILIKE '%android%' OR user_agent ILIKE '%iphone%' THEN 'Mobile'
          WHEN user_agent ILIKE '%tablet%' OR user_agent ILIKE '%ipad%' THEN 'Tablet'
          ELSE 'Desktop'
        END AS type,
        COUNT(DISTINCT session_id) AS sessions
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY type
      ORDER BY sessions DESC
    `,
      [days]
    ),

    queryMany<{ browser: string; sessions: string }>(
      `
      SELECT
        CASE
          WHEN user_agent ILIKE '%edg/%' OR user_agent ILIKE '%edge/%' THEN 'Edge'
          WHEN user_agent ILIKE '%opr/%' OR user_agent ILIKE '%opera%' THEN 'Opera'
          WHEN user_agent ILIKE '%chrome%' AND user_agent NOT ILIKE '%chromium%' THEN 'Chrome'
          WHEN user_agent ILIKE '%firefox%' THEN 'Firefox'
          WHEN user_agent ILIKE '%safari%' AND user_agent NOT ILIKE '%chrome%' THEN 'Safari'
          WHEN user_agent ILIKE '%chromium%' THEN 'Chromium'
          ELSE 'Other'
        END AS browser,
        COUNT(DISTINCT session_id) AS sessions
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY browser
      ORDER BY sessions DESC
    `,
      [days]
    ),

    queryMany<{ hour: string; hits: string }>(
      `
      SELECT
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
        COUNT(*) AS hits
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY hour
      ORDER BY hour ASC
    `,
      [days]
    ),

    queryMany<{ session_id: string; depth: string }>(
      `
      SELECT session_id, COUNT(*) AS depth
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY session_id
    `,
      [days]
    ),

    queryMany<{
      product_id: string
      name: string
      slug: string
      views: string
      unique_viewers: string
      orders: string
      revenue: string
      cart_adds: string
    }>(
      `
      SELECT
        pv.product_id,
        p.name,
        p.slug,
        COUNT(*) AS views,
        COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) AS unique_viewers,
        COALESCE(o.orders, 0) AS orders,
        COALESCE(o.revenue, 0) AS revenue,
        COALESCE(c.cart_adds, 0) AS cart_adds
      FROM product_views pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN (
        SELECT oi.product_id,
               COUNT(DISTINCT oi.order_id) AS orders,
               SUM(oi.total_price) AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= NOW() - INTERVAL '1 day' * $1
          AND o.payment_status = 'paid'
        GROUP BY oi.product_id
      ) o ON o.product_id = pv.product_id
      LEFT JOIN (
        SELECT product_id, COUNT(*) AS cart_adds
        FROM cart_items
        WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY product_id
      ) c ON c.product_id = pv.product_id
      WHERE pv.created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY pv.product_id, p.name, p.slug, o.orders, o.revenue, c.cart_adds
      ORDER BY views DESC
      LIMIT 15
    `,
      [days]
    ),

    queryMany<{ product_id: string; name: string; slug: string; views: string; orders: string }>(
      `
      SELECT
        pv.product_id,
        p.name,
        p.slug,
        COUNT(*) AS views,
        COALESCE(o.orders, 0) AS orders
      FROM product_views pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN (
        SELECT oi.product_id,
               COUNT(DISTINCT oi.order_id) AS orders
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= NOW() - INTERVAL '1 day' * $1
          AND o.payment_status = 'paid'
        GROUP BY oi.product_id
      ) o ON o.product_id = pv.product_id
      WHERE pv.created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY pv.product_id, p.name, p.slug, o.orders
      HAVING COUNT(*) >= 20 AND COALESCE(o.orders, 0) = 0
      ORDER BY views DESC
      LIMIT 10
    `,
      [days]
    ),

    queryMany<{ query: string; searches: string; clicks: string }>(
      `
      SELECT
        LOWER(TRIM(query)) AS query,
        COUNT(*) AS searches,
        COUNT(*) FILTER (WHERE results_count > 0) AS clicks
      FROM search_logs
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND LENGTH(TRIM(query)) >= 2
      GROUP BY LOWER(TRIM(query))
      ORDER BY searches DESC
      LIMIT 15
    `,
      [days]
    ).catch(() => [] as { query: string; searches: string; clicks: string }[]),

    queryMany<{ query: string; searches: string }>(
      `
      SELECT
        LOWER(TRIM(query)) AS query,
        COUNT(*) AS searches
      FROM search_logs
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND results_count = 0
        AND LENGTH(TRIM(query)) >= 2
      GROUP BY LOWER(TRIM(query))
      ORDER BY searches DESC
      LIMIT 10
    `,
      [days]
    ).catch(() => [] as { query: string; searches: string }[]),
  ])

  const funnelOrder = ['home', 'categories', 'category', 'product', 'cart', 'checkout', 'order_placed']
  const funnelMap: Record<string, { sessions: number; users: number }> = {}
  funnel.forEach(r => {
    funnelMap[r.page] = { sessions: parseInt(r.sessions), users: parseInt(r.users) }
  })

  const funnelSteps = funnelOrder.map(page => ({
    page,
    sessions: funnelMap[page]?.sessions || 0,
    users: funnelMap[page]?.users || 0,
  }))
  const topSessions = funnelSteps[0]?.sessions || 1

  const totalPageviews = dailySessions.reduce((s, r) => s + parseInt(r.pageviews), 0)
  const totalSessions = funnelSteps[0]?.sessions || 0
  const conversions = funnelSteps.find(s => s.page === 'order_placed')?.sessions || 0

  const depths = sessionDepths.map(r => parseInt(r.depth))
  const bouncedSessions = depths.filter(d => d === 1).length
  const bounceRate = depths.length > 0 ? Math.round((bouncedSessions / depths.length) * 100) : 0
  const avgPages = depths.length > 0 ? Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 10) / 10 : 0

  const hourMap: Record<number, number> = {}
  hourly.forEach(r => {
    hourMap[parseInt(r.hour)] = parseInt(r.hits)
  })
  const hourlyData = Array.from({ length: 24 }, (_, h) => ({ hour: h, hits: hourMap[h] || 0 }))

  return NextResponse.json({
    funnel: funnelSteps.map(s => ({
      ...s,
      pct: Math.round((s.sessions / topSessions) * 100),
    })),
    topPages: topPages.map(r => ({ path: r.path, hits: parseInt(r.hits), sessions: parseInt(r.sessions) })),
    topReferrers: topReferrers.map(r => ({ referrer: r.referrer, sessions: parseInt(r.sessions) })),
    dailySessions: dailySessions.map(r => ({
      date: r.date,
      sessions: parseInt(r.sessions),
      pageviews: parseInt(r.pageviews),
    })),
    devices: devices.map(r => ({ type: r.type, sessions: parseInt(r.sessions) })),
    browsers: browsers.map(r => ({ browser: r.browser, sessions: parseInt(r.sessions) })),
    hourly: hourlyData,
    topProducts: topProducts.map(r => {
      const views = parseInt(r.views)
      const orders = parseInt(r.orders)
      return {
        productId: r.product_id,
        name: r.name,
        slug: r.slug,
        views,
        uniqueViewers: parseInt(r.unique_viewers),
        cartAdds: parseInt(r.cart_adds),
        orders,
        revenue: parseFloat(r.revenue),
        conversionRate: views > 0 ? Math.round((orders / views) * 1000) / 10 : 0,
      }
    }),
    conversionLaggards: conversionLaggards.map(r => ({
      productId: r.product_id,
      name: r.name,
      slug: r.slug,
      views: parseInt(r.views),
      orders: parseInt(r.orders),
    })),
    topSearchTerms: topSearchTerms.map(r => ({
      query: r.query,
      searches: parseInt(r.searches),
      clicks: parseInt(r.clicks),
    })),
    noResultSearches: noResultSearches.map(r => ({
      query: r.query,
      searches: parseInt(r.searches),
    })),
    totals: {
      sessions: totalSessions,
      pageviews: totalPageviews,
      conversions,
      bounceRate,
      avgPages,
    },
  })
}
