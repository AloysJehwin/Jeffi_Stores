import { queryOne, queryMany } from './shared'
import { NEEDS_SHIP_SQL } from '@/lib/overviews/orders'
import type { ActivityChannel, ActivityDay, DashboardActivity } from '@/lib/dashboard/activity-types'

const TZ = `'Asia/Kolkata'` // the store's local timezone, as every overview uses
const WEEKS_MAX = 52
const TTS_BUCKETS = ['<1d', '1-2d', '2-4d', '4-7d', '7d+'] as const

// Channels are mutually exclusive: business buyer (GSTIN or business discount) first, then COD, then the rest.
const BIZ = `(COALESCE(o.buyer_gstin, '') <> '' OR COALESCE(o.business_discount_amount, 0) > 0)`
const COD = `COALESCE(o.payment_mode, '') ILIKE '%cod%'`
const CHANNEL_SQL: Record<ActivityChannel, string> = {
  all: 'TRUE',
  business: BIZ,
  cod: `NOT ${BIZ} AND ${COD}`,
  online: `NOT ${BIZ} AND NOT ${COD}`,
}

const num = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0)
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const pct = (a: number, b: number) => (b > 0 ? round((a / b) * 100, 1) : null)

const DAY_MS = 86_400_000
const parseDay = (s: string) => Date.parse(`${s}T00:00:00Z`)
const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const mondayOf = (s: string) => parseDay(s) - ((new Date(parseDay(s)).getUTCDay() + 6) % 7) * DAY_MS

/**
 * Fulfilment activity for the dashboard's "Orders shipped" card and drawer.
 * "Shipped" = orders.shipped_at: the one timestamp every shipping path stamps (admin status change,
 * Delhivery sync, track route), and the one the orders overview already uses. Days are Asia/Kolkata days.
 * On-time = shipped within 2 days (< 48h) of being placed.
 */
export async function getDashboardActivity({
  weeks: weeksIn = 26,
  channel: channelIn = 'all',
}: { weeks?: number; channel?: ActivityChannel } = {}): Promise<DashboardActivity> {
  const weeks = Math.min(WEEKS_MAX, Math.max(1, Math.floor(weeksIn) || 26))
  const channel: ActivityChannel = channelIn in CHANNEL_SQL ? channelIn : 'all'
  const chan = CHANNEL_SQL[channel]

  const todayRow = await queryOne<{ today: string }>(
    `SELECT to_char((NOW() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS today`
  )
  const today = todayRow?.today ?? fmtDay(Date.now() + 5.5 * 3_600_000)
  const monday = mondayOf(today)
  const fromMs = monday - (weeks - 1) * 7 * DAY_MS
  const from = fmtDay(fromMs)
  const to = fmtDay(monday + 6 * DAY_MS)
  const mondayStr = fmtDay(monday)

  // $1 = first Monday, $2 = last Sunday, $3 = this week's Monday; bounds are local-midnight timestamps.
  const range = (col: string) =>
    `${col} >= ($1::date)::timestamp AT TIME ZONE ${TZ} AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE ${TZ}`
  const shippedWhere = `o.shipped_at IS NOT NULL AND ${range('o.shipped_at')} AND o.status <> 'draft' AND ${chan}`
  const days_ = `GREATEST(EXTRACT(EPOCH FROM (o.shipped_at - o.created_at)) / 86400, 0)`
  const localDay = `(o.shipped_at AT TIME ZONE ${TZ})::date`
  const args = [from, to, mondayStr]

  const weekCols = Array.from({ length: 8 }, (_, k) => `SUM(oi.quantity) FILTER (WHERE ts.wk = ${k}) AS w${k}`).join(', ')

  const [dayRows, catRows, tts, backlogRow, prodRows] = await Promise.all([
    queryMany<Record<string, string>>(
      `WITH placed AS (
         SELECT (o.created_at AT TIME ZONE ${TZ})::date AS d, COUNT(*) AS n
           FROM orders o
          WHERE ${range('o.created_at')} AND o.status <> 'draft' AND ${chan}
          GROUP BY 1
       ), shipped AS (
         SELECT ${localDay} AS d, COUNT(*) AS n,
                COUNT(DISTINCT COALESCE(o.user_id::text, NULLIF(o.customer_email, ''), NULLIF(o.customer_phone, ''), o.id::text)) AS customers
           FROM orders o
          WHERE ${shippedWhere}
          GROUP BY 1
       )
       SELECT to_char(COALESCE(p.d, s.d), 'YYYY-MM-DD') AS day,
              COALESCE(p.n, 0) AS placed, COALESCE(s.n, 0) AS shipped, COALESCE(s.customers, 0) AS customers
         FROM placed p FULL JOIN shipped s ON s.d = p.d`,
      args.slice(0, 2)
    ),
    queryMany<Record<string, string>>(
      `SELECT day, name, units FROM (
         SELECT day, name, units, ROW_NUMBER() OVER (PARTITION BY day ORDER BY units DESC, name) AS rn FROM (
           SELECT to_char(${localDay}, 'YYYY-MM-DD') AS day,
                  COALESCE(c.name, 'Uncategorized') AS name, SUM(oi.quantity) AS units
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
             LEFT JOIN products p ON p.id = oi.product_id
             LEFT JOIN categories c ON c.id = p.category_id
            WHERE ${shippedWhere}
            GROUP BY 1, 2
         ) g
       ) r WHERE rn <= 3`,
      args.slice(0, 2)
    ),
    queryOne<Record<string, string>>(
      `WITH t AS (SELECT ${days_} AS d FROM orders o WHERE ${shippedWhere})
       SELECT COUNT(*) FILTER (WHERE d < 1) AS b0,
              COUNT(*) FILTER (WHERE d >= 1 AND d < 2) AS b1,
              COUNT(*) FILTER (WHERE d >= 2 AND d < 4) AS b2,
              COUNT(*) FILTER (WHERE d >= 4 AND d < 7) AS b3,
              COUNT(*) FILTER (WHERE d >= 7) AS b4,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY d::float8) AS median
         FROM t`,
      args.slice(0, 2)
    ),
    queryOne<Record<string, string>>(
      `SELECT COUNT(*) AS n FROM orders o
        WHERE o.shipped_at IS NULL AND o.status NOT IN ('draft', 'cancelled', 'returned', 'delivered', 'granted')
          AND ${NEEDS_SHIP_SQL} AND ${chan}`
    ),
    queryMany<Record<string, string>>(
      `SELECT COALESCE(oi.product_id::text, oi.product_name) AS id,
              MAX(COALESCE(p.name, oi.product_name)) AS name,
              SUM(oi.quantity) AS shipped,
              COUNT(DISTINCT o.id) AS orders,
              COUNT(DISTINCT o.id) FILTER (WHERE ts.d < 2) AS on_time,
              AVG(ts.d) AS avg_days,
              ${weekCols}
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN products p ON p.id = oi.product_id
        CROSS JOIN LATERAL (SELECT ${days_} AS d,
                                   (($3::date - date_trunc('week', o.shipped_at AT TIME ZONE ${TZ})::date) / 7) AS wk) ts
        WHERE ${shippedWhere}
        GROUP BY 1
        ORDER BY shipped DESC, name
        LIMIT 8`,
      args
    ),
  ])

  const byDay = new Map<string, Record<string, string>>()
  for (const r of dayRows ?? []) byDay.set(String(r.day), r)
  const topByDay = new Map<string, { name: string; count: number }[]>()
  for (const r of catRows ?? []) {
    const list = topByDay.get(String(r.day)) ?? []
    list.push({ name: String(r.name), count: round(num(r.units)) })
    topByDay.set(String(r.day), list)
  }

  const days: ActivityDay[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const date = fmtDay(fromMs + i * DAY_MS)
    const r = byDay.get(date)
    days.push({
      date,
      shipped: Math.round(num(r?.shipped)),
      placed: Math.round(num(r?.placed)),
      customers: Math.round(num(r?.customers)),
      top: (topByDay.get(date) ?? []).sort((a, b) => b.count - a.count).slice(0, 3),
    })
  }

  let busiest: { date: string; count: number } | null = null
  let longest = 0
  let run = 0
  let total = 0
  for (const d of days) {
    total += d.shipped
    if (d.shipped > (busiest?.count ?? 0)) busiest = { date: d.date, count: d.shipped }
    run = d.shipped > 0 ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  // Current streak ends today, or yesterday while nothing has shipped yet today.
  const todayIdx = days.findIndex(d => d.date === today)
  let current = 0
  for (let i = todayIdx - (days[todayIdx]?.shipped ? 0 : 1); i >= 0 && days[i].shipped > 0; i--) current++

  // Weekday averages cover elapsed days only, so the empty future doesn't drag them down.
  const weekday = Array.from({ length: 7 }, (_, day) => {
    const past = days.filter((d, i) => i % 7 === day && d.date <= today)
    return { day, avg: past.length ? round(past.reduce((s, d) => s + d.shipped, 0) / past.length) : 0 }
  })

  const weekStartIdx = (weeks - 1) * 7
  const thisWeek = days.slice(weekStartIdx).map(d => ({ date: d.date, placed: d.placed }))
  const prevWeeks = Math.min(8, weeks - 1)
  const prevDays = days.slice(weekStartIdx - prevWeeks * 7, weekStartIdx)
  const placedAvg8w = prevDays.length ? round(prevDays.reduce((s, d) => s + d.placed, 0) / prevDays.length) : 0

  const throughput = Array.from({ length: weeks }, (_, w) => {
    const wk = days.slice(w * 7, w * 7 + 7)
    return {
      weekStart: wk[0].date,
      placed: wk.reduce((s, d) => s + d.placed, 0),
      shipped: wk.reduce((s, d) => s + d.shipped, 0),
    }
  })

  const counts = [0, 1, 2, 3, 4].map(i => Math.round(num(tts?.[`b${i}`])))
  const ttsTotal = counts.reduce((a, b) => a + b, 0)

  return {
    weeks,
    channel,
    from,
    to,
    days,
    totals: { shipped: total, busiestDay: busiest, longestStreak: longest, currentStreak: current },
    weekday,
    thisWeek,
    placedAvg8w,
    timeToShip: TTS_BUCKETS.map((bucket, i) => ({ bucket, count: counts[i] })),
    medianDaysToShip: tts?.median == null ? null : round(num(tts.median)),
    shippedWithin2dPct: pct(counts[0] + counts[1], ttsTotal),
    throughput,
    backlog: Math.round(num(backlogRow?.n)),
    topProducts: (prodRows ?? []).map(r => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      shipped: round(num(r.shipped)),
      onTimePct: pct(num(r.on_time), num(r.orders)),
      avgDays: r.avg_days == null ? null : round(num(r.avg_days)),
      weekly: [7, 6, 5, 4, 3, 2, 1, 0].map(k => round(num(r[`w${k}`]))),
    })),
  }
}
