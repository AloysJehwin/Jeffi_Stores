import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7'), 1), 90)

  const [funnel, topPages, topReferrers, dailySessions, devices, browsers, hourly, sessionDepths] = await Promise.all([
    queryMany<{ page: string; sessions: string; users: string }>(`
      SELECT
        page,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(DISTINCT user_id)    AS users
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND page IN ('home','categories','category','product','cart','checkout','order_placed')
      GROUP BY page
    `, [days]),

    queryMany<{ path: string; hits: string; sessions: string }>(`
      SELECT path, COUNT(*) AS hits, COUNT(DISTINCT session_id) AS sessions
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY path
      ORDER BY hits DESC
      LIMIT 15
    `, [days]),

    queryMany<{ referrer: string; sessions: string }>(`
      SELECT
        COALESCE(NULLIF(referrer, ''), 'Direct') AS referrer,
        COUNT(DISTINCT session_id) AS sessions
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY referrer
      ORDER BY sessions DESC
      LIMIT 10
    `, [days]),

    queryMany<{ date: string; sessions: string; pageviews: string }>(`
      SELECT
        DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS date,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) AS pageviews
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY DATE(created_at AT TIME ZONE 'Asia/Kolkata')
      ORDER BY date ASC
    `, [days]),

    queryMany<{ type: string; sessions: string }>(`
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
    `, [days]),

    queryMany<{ browser: string; sessions: string }>(`
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
    `, [days]),

    queryMany<{ hour: string; hits: string }>(`
      SELECT
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
        COUNT(*) AS hits
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY hour
      ORDER BY hour ASC
    `, [days]),

    queryMany<{ session_id: string; depth: string }>(`
      SELECT session_id, COUNT(*) AS depth
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY session_id
    `, [days]),
  ])

  const funnelOrder = ['home', 'categories', 'category', 'product', 'cart', 'checkout', 'order_placed']
  const funnelMap: Record<string, { sessions: number; users: number }> = {}
  funnel.forEach(r => { funnelMap[r.page] = { sessions: parseInt(r.sessions), users: parseInt(r.users) } })

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
  const avgPages = depths.length > 0
    ? Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 10) / 10
    : 0

  const hourMap: Record<number, number> = {}
  hourly.forEach(r => { hourMap[parseInt(r.hour)] = parseInt(r.hits) })
  const hourlyData = Array.from({ length: 24 }, (_, h) => ({ hour: h, hits: hourMap[h] || 0 }))

  return NextResponse.json({
    funnel: funnelSteps.map(s => ({
      ...s,
      pct: Math.round((s.sessions / topSessions) * 100),
    })),
    topPages: topPages.map(r => ({ path: r.path, hits: parseInt(r.hits), sessions: parseInt(r.sessions) })),
    topReferrers: topReferrers.map(r => ({ referrer: r.referrer, sessions: parseInt(r.sessions) })),
    dailySessions: dailySessions.map(r => ({ date: r.date, sessions: parseInt(r.sessions), pageviews: parseInt(r.pageviews) })),
    devices: devices.map(r => ({ type: r.type, sessions: parseInt(r.sessions) })),
    browsers: browsers.map(r => ({ browser: r.browser, sessions: parseInt(r.sessions) })),
    hourly: hourlyData,
    totals: {
      sessions: totalSessions,
      pageviews: totalPageviews,
      conversions,
      bounceRate,
      avgPages,
    },
  })
}
