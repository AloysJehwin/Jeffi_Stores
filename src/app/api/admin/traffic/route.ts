import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') || '7')

  const [funnel, topPages, topReferrers, dailySessions, devices] = await Promise.all([
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

    queryMany<{ path: string; hits: string }>(`
      SELECT path, COUNT(*) AS hits
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY path
      ORDER BY hits DESC
      LIMIT 10
    `, [days]),

    queryMany<{ referrer: string; sessions: string }>(`
      SELECT
        COALESCE(NULLIF(referrer, ''), 'Direct') AS referrer,
        COUNT(DISTINCT session_id) AS sessions
      FROM page_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY referrer
      ORDER BY sessions DESC
      LIMIT 8
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

  return NextResponse.json({
    funnel: funnelSteps.map(s => ({
      ...s,
      pct: Math.round((s.sessions / topSessions) * 100),
    })),
    topPages: topPages.map(r => ({ path: r.path, hits: parseInt(r.hits) })),
    topReferrers: topReferrers.map(r => ({ referrer: r.referrer, sessions: parseInt(r.sessions) })),
    dailySessions: dailySessions.map(r => ({ date: r.date, sessions: parseInt(r.sessions), pageviews: parseInt(r.pageviews) })),
    devices: devices.map(r => ({ type: r.type, sessions: parseInt(r.sessions) })),
    totals: {
      sessions: funnelSteps[0]?.sessions || 0,
      pageviews: dailySessions.reduce((s, r) => s + parseInt(r.pageviews), 0),
      conversions: funnelSteps.find(s => s.page === 'order_placed')?.sessions || 0,
    },
  })
}
