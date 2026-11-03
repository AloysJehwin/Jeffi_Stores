import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketKeys, fillSeries, istBounds, previousPeriod, trendBucket, type Period } from './period'
import { classifyChannel, sourceLabel, CHANNEL_GROUPS } from './channels'
import { parseUserAgent } from './user-agent'
import {
  buildFunnel,
  channelRows,
  drillDowns,
  funnelBreakdown,
  overviewAttention,
  paidTrend,
  productFlags,
  uaShares,
  type FunnelTuple,
  type OrderTuple,
  type SessionTuple,
  type UaTuple,
} from './compute'
import type {
  AcquisitionData,
  AudienceData,
  BehaviourData,
  CoreTotals,
  FunnelData,
  OverviewData,
  PeriodInfo,
  ProductRow,
  ProductsData,
  RealtimeData,
  SearchData,
  SearchTerm,
  SearchTotals,
  TrafficTab,
  TrafficTabData,
} from './types'

// SQL for the Traffic tabs. Every query is bounded by created_at (page_events, product_views,
// orders, search_logs all have a created_at index). Sessions are page_events.session_id (one per
// browser tab, sessionStorage); an order belongs to a session when the session opened that order's
// page (/account/orders/<id>, the post-checkout redirect) within a day of the order.

const UUID_RE = `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
/** Orders that count as demand, as in lib/analytics/traffic-sources. */
const COUNTED = `o.source = 'online' AND o.status <> 'cancelled' AND o.payment_status <> 'unpaid'`
const PAID = `('paid', 'cod_collected')`
const ORDER_RANGE = `o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz`

/** CTEs over $1..$2: ev (events), sess (one row per session), conv (orders reached), sconv. */
const SESSION_CTES = `
ev AS (
  SELECT session_id, user_id, page, path, referrer, user_agent, ip_address, created_at,
         utm_source, utm_medium, utm_campaign, (COALESCE(gclid, gbraid, wbraid) IS NOT NULL) AS gclick
  FROM page_events
  WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
),
sess AS (
  SELECT session_id,
         MIN(created_at) AS started,
         COUNT(*)::int AS pv,
         (array_agg(path ORDER BY created_at))[1] AS landing,
         (array_agg(path ORDER BY created_at DESC))[1] AS exit_path,
         (array_agg(user_agent ORDER BY created_at))[1] AS ua,
         LOWER(NULLIF((array_agg(utm_source ORDER BY created_at))[1], '')) AS source,
         LOWER(NULLIF((array_agg(utm_medium ORDER BY created_at))[1], '')) AS medium,
         NULLIF((array_agg(utm_campaign ORDER BY created_at))[1], '') AS campaign,
         (array_agg(gclick ORDER BY created_at))[1] AS gclick,
         LOWER(regexp_replace(substring((array_agg(referrer ORDER BY created_at))[1] from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'), '^www\\.', '')) AS ref_host,
         MAX(user_id::text) AS user_key,
         COALESCE(host((array_agg(ip_address ORDER BY created_at))[1]), '') || '|' ||
           md5(COALESCE((array_agg(user_agent ORDER BY created_at))[1], '')) AS anon_key,
         bool_or(page = 'product') AS saw_product,
         bool_or(page = 'cart') AS saw_cart,
         bool_or(page = 'checkout') AS saw_checkout
  FROM ev
  GROUP BY session_id
),
conv AS (
  SELECT DISTINCT ON (o.id) e.session_id, o.id, o.total_amount, o.payment_status, o.status
  FROM ev e
  JOIN orders o ON o.id = CASE WHEN split_part(e.path, '/', 4) ~ ${UUID_RE} THEN split_part(e.path, '/', 4)::uuid END
  WHERE e.page = 'order_placed'
    AND e.created_at >= o.created_at - INTERVAL '10 minutes'
    AND e.created_at < o.created_at + INTERVAL '1 day'
  ORDER BY o.id, e.created_at
),
sconv AS (
  SELECT session_id,
         COUNT(*)::int AS orders,
         (COUNT(*) FILTER (WHERE payment_status IN ${PAID}))::int AS paid,
         COALESCE(SUM(total_amount) FILTER (WHERE status <> 'cancelled'), 0)::float8 AS revenue
  FROM conv
  GROUP BY session_id
)`

/** Adds snew (is_new per session): first session of a visitor key not seen in the 90 days before $1. */
const NEW_CTES = `,
prior AS (
  SELECT DISTINCT v.k
  FROM page_events pe
  CROSS JOIN LATERAL (VALUES (pe.user_id::text), (COALESCE(host(pe.ip_address), '') || '|' || md5(COALESCE(pe.user_agent, '')))) v(k)
  WHERE pe.created_at >= $1::timestamptz - INTERVAL '90 days' AND pe.created_at < $1::timestamptz AND v.k IS NOT NULL
),
snew AS (
  SELECT s.session_id,
         (ROW_NUMBER() OVER (PARTITION BY COALESCE(s.user_key, s.anon_key) ORDER BY s.started) = 1
           AND NOT EXISTS (SELECT 1 FROM prior WHERE k = s.anon_key)
           AND (s.user_key IS NULL OR NOT EXISTS (SELECT 1 FROM prior WHERE k = s.user_key))) AS is_new
  FROM sess s
)`

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export interface ReportContext {
  /** Hosts of this store; a referrer on one of them is internal (direct). */
  selfHosts: string[]
}

function periodInfo(p: Period): PeriodInfo {
  const prev = previousPeriod(p)
  return { from: p.from, to: p.to, prevFrom: prev.from, prevTo: prev.to, bucket: trendBucket(p) }
}

// Raw /admin paths; the client maps them for admin hosts.
const link = (tab: string) => `/admin/traffic?tab=${tab}`
const productHref = (id: string) => `/admin/products/${id}`

// ── shared pieces ────────────────────────────────────────────────────────────

async function coreTotals(p: Period): Promise<CoreTotals> {
  const b = istBounds(p)
  const [s, o] = await Promise.all([
    queryOne(
      `WITH ${SESSION_CTES}
       SELECT COUNT(*)::int AS sessions,
              COUNT(DISTINCT COALESCE(s.user_key, s.anon_key))::int AS visitors,
              COALESCE(SUM(s.pv), 0)::int AS pageviews,
              (COUNT(*) FILTER (WHERE s.pv = 1))::int AS bounces,
              (COUNT(*) FILTER (WHERE s.saw_checkout))::int AS checkout_sessions,
              (COUNT(*) FILTER (WHERE c.orders > 0))::int AS converted,
              COALESCE(SUM(c.orders), 0)::int AS tracked_orders,
              COALESCE(SUM(c.revenue), 0)::float8 AS tracked_revenue
       FROM sess s LEFT JOIN sconv c USING (session_id)`,
      b
    ),
    queryOne(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total_amount), 0)::float8 AS revenue FROM orders o WHERE ${ORDER_RANGE} AND ${COUNTED}`, b),
  ])
  return {
    visitors: num(s?.visitors),
    sessions: num(s?.sessions),
    pageviews: num(s?.pageviews),
    bounces: num(s?.bounces),
    checkoutSessions: num(s?.checkout_sessions),
    convertedSessions: num(s?.converted),
    trackedOrders: num(s?.tracked_orders),
    trackedRevenue: num(s?.tracked_revenue),
    orders: num(o?.orders),
    revenue: num(o?.revenue),
  }
}

async function sessionTuples(p: Period, withBucket: boolean, withNew: boolean): Promise<SessionTuple[]> {
  const params: string[] = [...istBounds(p)]
  if (withBucket) params.push(trendBucket(p))
  const bucket = withBucket ? `to_char(date_trunc($3, s.started AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')` : `NULL::text`
  const rows = await queryMany(
    `WITH ${SESSION_CTES}${withNew ? NEW_CTES : ''}
     SELECT ${bucket} AS bucket, s.source, s.medium, s.campaign, s.gclick, s.ref_host,
            COUNT(*)::int AS sessions,
            ${withNew ? '(COUNT(*) FILTER (WHERE n.is_new))::int' : '0'} AS new_visitors,
            (COUNT(*) FILTER (WHERE c.orders > 0))::int AS converted,
            COALESCE(SUM(c.orders), 0)::int AS orders,
            COALESCE(SUM(c.revenue), 0)::float8 AS revenue
     FROM sess s
     LEFT JOIN sconv c USING (session_id)
     ${withNew ? 'LEFT JOIN snew n USING (session_id)' : ''}
     GROUP BY 1, 2, 3, 4, 5, 6
     LIMIT 20000`,
    params
  )
  return rows.map(r => ({
    bucket: r.bucket ?? undefined,
    source: r.source,
    medium: r.medium,
    campaign: r.campaign,
    gclick: !!r.gclick,
    refHost: r.ref_host,
    sessions: num(r.sessions),
    newVisitors: num(r.new_visitors),
    converted: num(r.converted),
    orders: num(r.orders),
    revenue: num(r.revenue),
  }))
}

async function orderTuples(p: Period): Promise<OrderTuple[]> {
  const rows = await queryMany(
    `SELECT LOWER(NULLIF(o.utm_source, '')) AS source, LOWER(NULLIF(o.utm_medium, '')) AS medium,
            NULLIF(o.utm_campaign, '') AS campaign,
            COALESCE(o.gclid, o.gbraid, o.wbraid) IS NOT NULL AS gclick,
            COALESCE(o.meta_click_ids ? 'fbc' OR o.meta_click_ids ? 'fbclid', false) AS mclick,
            COUNT(*)::int AS orders, COALESCE(SUM(o.total_amount), 0)::float8 AS revenue
     FROM orders o
     WHERE ${ORDER_RANGE} AND ${COUNTED}
     GROUP BY 1, 2, 3, 4, 5`,
    istBounds(p)
  )
  return rows.map(r => ({
    source: r.source,
    medium: r.medium,
    campaign: r.campaign,
    gclick: !!r.gclick,
    mclick: !!r.mclick,
    orders: num(r.orders),
    revenue: num(r.revenue),
  }))
}

async function laggards(p: Period, limit: number) {
  const rows = await queryMany(
    `WITH pv AS (
       SELECT product_id, COUNT(*)::int AS views FROM product_views
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY product_id HAVING COUNT(*) >= 20
     ),
     oi AS (
       SELECT oi.product_id, COUNT(DISTINCT oi.order_id)::int AS orders
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE ${ORDER_RANGE} AND ${COUNTED} AND oi.product_id IN (SELECT product_id FROM pv)
       GROUP BY oi.product_id
     )
     SELECT pv.product_id, p.name, pv.views
     FROM pv JOIN products p ON p.id = pv.product_id LEFT JOIN oi USING (product_id)
     WHERE COALESCE(oi.orders, 0) = 0
     ORDER BY pv.views DESC LIMIT ${limit}`,
    istBounds(p)
  )
  return rows.map(r => ({ productId: r.product_id, name: r.name, views: num(r.views) }))
}

async function searchTotals(p: Period): Promise<SearchTotals> {
  const r = await queryOne(
    `WITH sl AS (
       SELECT user_id, session_id, results_count, created_at FROM search_logs
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz AND LENGTH(TRIM(query)) >= 2
     ),
     firsts AS (SELECT user_id, MIN(created_at) AS first_at FROM sl WHERE user_id IS NOT NULL GROUP BY user_id)
     SELECT (SELECT COUNT(*) FROM sl)::int AS searches,
            (SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id)) FROM sl)::int AS searchers,
            (SELECT COUNT(*) FROM sl WHERE results_count = 0)::int AS zero,
            (SELECT COUNT(*) FROM firsts)::int AS signed_in,
            (SELECT COUNT(*) FROM firsts f WHERE EXISTS (
               SELECT 1 FROM orders o WHERE o.user_id = f.user_id AND o.created_at >= f.first_at
                 AND o.created_at < $2::timestamptz + INTERVAL '1 day' AND ${COUNTED}))::int AS purchasers`,
    istBounds(p)
  )
  return {
    searches: num(r?.searches),
    searchers: num(r?.searchers),
    zeroResults: num(r?.zero),
    signedInSearchers: num(r?.signed_in),
    purchasers: num(r?.purchasers),
  }
}

// ── tabs ─────────────────────────────────────────────────────────────────────

export async function overviewReport(p: Period, ctx: ReportContext): Promise<OverviewData> {
  const prev = previousPeriod(p)
  const b = istBounds(p)
  const bucket = trendBucket(p)
  const [current, previous, sTuples, pTuples, oTuples, pOTuples, trendS, trendO, landing, products, lag, search] = await Promise.all([
    coreTotals(p),
    coreTotals(prev),
    sessionTuples(p, false, false),
    sessionTuples(prev, false, false),
    orderTuples(p),
    orderTuples(prev),
    queryMany(
      `SELECT to_char(date_trunc($3, created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS bucket,
              COUNT(DISTINCT session_id)::int AS sessions, COUNT(*)::int AS pageviews
       FROM page_events WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY 1`,
      [...b, bucket]
    ),
    queryMany(
      `SELECT to_char(date_trunc($3, o.created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS bucket, COUNT(*)::int AS orders
       FROM orders o WHERE ${ORDER_RANGE} AND ${COUNTED} GROUP BY 1`,
      [...b, bucket]
    ),
    queryMany(
      `WITH ${SESSION_CTES}
       SELECT s.landing AS path, COUNT(*)::int AS sessions, (COUNT(*) FILTER (WHERE c.orders > 0))::int AS converted
       FROM sess s LEFT JOIN sconv c USING (session_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      b
    ),
    queryMany(
      `SELECT pv.product_id, p.name, COUNT(*)::int AS views
       FROM product_views pv JOIN products p ON p.id = pv.product_id
       WHERE pv.created_at >= $1::timestamptz AND pv.created_at < $2::timestamptz
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 5`,
      b
    ),
    laggards(p, 3),
    searchTotals(p),
  ])

  const keys = bucketKeys(p, bucket)
  const so = new Map(trendO.map(r => [r.bucket, num(r.orders)]))
  const trend = fillSeries(
    keys,
    trendS.map(r => ({ bucket: r.bucket, sessions: num(r.sessions), pageviews: num(r.pageviews), orders: 0 })),
    k => ({ bucket: k, sessions: 0, pageviews: 0, orders: 0 })
  ).map(r => ({ ...r, orders: so.get(r.bucket) ?? 0 }))

  const channels = channelRows(sTuples, oTuples, ctx.selfHosts)
  const previousChannels = channelRows(pTuples, pOTuples, ctx.selfHosts)
  return {
    period: periodInfo(p),
    current,
    previous,
    trend,
    topSources: channels.slice(0, 5),
    topLanding: landing.map(r => ({ path: r.path, sessions: num(r.sessions), convertedSessions: num(r.converted) })),
    topProducts: products.map(r => ({ productId: r.product_id, name: r.name, views: num(r.views) })),
    attention: overviewAttention({
      current,
      previous,
      channels,
      previousChannels,
      laggards: lag,
      search,
      links: {
        acquisition: link('acquisition'),
        products: link('products'),
        search: link('search'),
        funnel: link('funnel'),
        product: productHref,
      },
    }),
  }
}

export async function acquisitionReport(p: Period, ctx: ReportContext): Promise<AcquisitionData> {
  const prev = previousPeriod(p)
  const [cur, prevS, orders, prevO] = await Promise.all([
    sessionTuples(p, true, true),
    sessionTuples(prev, false, false),
    orderTuples(p),
    orderTuples(prev),
  ])
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
  return {
    period: periodInfo(p),
    channels: channelRows(cur, orders, ctx.selfHosts),
    previousChannels: channelRows(prevS, prevO, ctx.selfHosts),
    ...drillDowns(cur, orders, ctx.selfHosts),
    paidTrend: paidTrend(bucketKeys(p, trendBucket(p)), cur, ctx.selfHosts),
    totals: {
      sessions: sum(cur, t => t.sessions),
      orders: sum(orders, t => t.orders),
      revenue: sum(orders, t => t.revenue),
      attributedOrders: sum(
        orders.filter(t => t.gclick || t.mclick || t.source),
        t => t.orders
      ),
    },
  }
}

export async function behaviourReport(p: Period): Promise<BehaviourData> {
  const b = istBounds(p)
  const [pages, landing, types, depth, heat] = await Promise.all([
    queryMany(
      `WITH ${SESSION_CTES},
       pg AS (SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT session_id)::int AS sessions FROM ev GROUP BY path ORDER BY views DESC LIMIT 100),
       en AS (SELECT landing AS path, COUNT(*)::int AS entries FROM sess GROUP BY 1),
       ex AS (SELECT exit_path AS path, COUNT(*)::int AS exits FROM sess GROUP BY 1)
       SELECT pg.path, pg.views, pg.sessions, COALESCE(en.entries, 0) AS entries, COALESCE(ex.exits, 0) AS exits
       FROM pg LEFT JOIN en USING (path) LEFT JOIN ex USING (path) ORDER BY pg.views DESC`,
      b
    ),
    queryMany(
      `WITH ${SESSION_CTES}
       SELECT s.landing AS path, COUNT(*)::int AS sessions, (COUNT(*) FILTER (WHERE s.pv = 1))::int AS bounces,
              (COUNT(*) FILTER (WHERE c.orders > 0))::int AS converted, COALESCE(SUM(c.revenue), 0)::float8 AS revenue
       FROM sess s LEFT JOIN sconv c USING (session_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
      b
    ),
    queryMany(
      `SELECT page, COUNT(*)::int AS views FROM page_events
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY 1 ORDER BY 2 DESC`,
      b
    ),
    queryMany(
      `WITH d AS (SELECT session_id, COUNT(*) AS n FROM page_events
                  WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY session_id)
       SELECT CASE WHEN n = 1 THEN '1' WHEN n = 2 THEN '2' WHEN n = 3 THEN '3' WHEN n = 4 THEN '4'
                   WHEN n <= 9 THEN '5-9' WHEN n <= 19 THEN '10-19' ELSE '20+' END AS bucket,
              COUNT(*)::int AS sessions
       FROM d GROUP BY 1`,
      b
    ),
    queryMany(
      `SELECT EXTRACT(ISODOW FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS dow,
              EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, COUNT(*)::int AS views
       FROM page_events WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY 1, 2`,
      b
    ),
  ])
  const order = ['1', '2', '3', '4', '5-9', '10-19', '20+']
  const dm = new Map(depth.map(r => [r.bucket, num(r.sessions)]))
  return {
    period: periodInfo(p),
    pages: pages.map(r => ({ path: r.path, views: num(r.views), sessions: num(r.sessions), entries: num(r.entries), exits: num(r.exits) })),
    landing: landing.map(r => ({
      path: r.path,
      sessions: num(r.sessions),
      bounces: num(r.bounces),
      convertedSessions: num(r.converted),
      revenue: num(r.revenue),
    })),
    pageTypes: types.map(r => ({ page: r.page, views: num(r.views) })),
    depth: order.map(k => ({ bucket: k, sessions: dm.get(k) ?? 0 })),
    heatmap: heat.map(r => ({ dow: num(r.dow), hour: num(r.hour), views: num(r.views) })),
  }
}

/** A step counts sessions that reached it or any later step ("Buy now" skips the cart). */
const FUNNEL_COLS = `(COUNT(*) FILTER (WHERE s.saw_product OR s.saw_cart OR s.saw_checkout OR c.orders > 0))::int AS product,
            (COUNT(*) FILTER (WHERE s.saw_cart OR s.saw_checkout OR c.orders > 0))::int AS cart,
            (COUNT(*) FILTER (WHERE s.saw_checkout OR c.orders > 0))::int AS checkout,
            (COUNT(*) FILTER (WHERE c.orders > 0))::int AS placed,
            (COUNT(*) FILTER (WHERE c.paid > 0))::int AS paid`

async function funnelCounts(p: Period) {
  const r = await queryOne(
    `WITH ${SESSION_CTES}
     SELECT COUNT(*)::int AS sessions,
            ${FUNNEL_COLS}
     FROM sess s LEFT JOIN sconv c USING (session_id)`,
    istBounds(p)
  )
  return {
    sessions: num(r?.sessions),
    product: num(r?.product),
    cart: num(r?.cart),
    checkout: num(r?.checkout),
    placed: num(r?.placed),
    paid: num(r?.paid),
  }
}

const FUNNEL_STEPS = [
  { key: 'sessions', label: 'Session' },
  { key: 'product', label: 'Viewed a product' },
  { key: 'cart', label: 'Reached the cart' },
  { key: 'checkout', label: 'Started checkout' },
  { key: 'placed', label: 'Placed an order' },
  { key: 'paid', label: 'Order paid' },
] as const

export async function funnelReport(p: Period, ctx: ReportContext): Promise<FunnelData> {
  const b = istBounds(p)
  const [cur, prev, tuples, intents, carts] = await Promise.all([
    funnelCounts(p),
    funnelCounts(previousPeriod(p)),
    queryMany(
      `WITH ${SESSION_CTES}
       SELECT s.ua, s.source, s.medium, s.campaign, s.gclick, s.ref_host,
              COUNT(*)::int AS sessions,
              ${FUNNEL_COLS}
       FROM sess s LEFT JOIN sconv c USING (session_id)
       GROUP BY 1, 2, 3, 4, 5, 6 LIMIT 20000`,
      b
    ),
    queryOne(
      `SELECT COUNT(*)::int AS started, (COUNT(*) FILTER (WHERE committed))::int AS committed
       FROM pending_payment_intents WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
      b
    ).catch(() => null),
    queryMany(
      `WITH ci AS (
         SELECT user_id, COUNT(*)::int AS items,
                COALESCE(SUM(quantity * COALESCE(price_at_addition, snapshot_price, 0)), 0)::float8 AS value,
                MAX(created_at) AS last_added
         FROM cart_items
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
           AND COALESCE(saved_for_later, false) = false AND user_id IS NOT NULL
         GROUP BY user_id
       )
       SELECT ci.user_id, u.email, NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS name,
              ci.items, ci.value, ci.last_added
       FROM ci LEFT JOIN users u ON u.id = ci.user_id
       WHERE ci.last_added < NOW() - INTERVAL '1 hour'
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = ci.user_id AND o.created_at >= ci.last_added)
       ORDER BY ci.value DESC`,
      b
    ),
  ])
  const ft: FunnelTuple[] = tuples.map(r => ({
    ua: r.ua,
    source: r.source,
    medium: r.medium,
    campaign: r.campaign,
    gclick: !!r.gclick,
    refHost: r.ref_host,
    sessions: num(r.sessions),
    product: num(r.product),
    cart: num(r.cart),
    checkout: num(r.checkout),
    placed: num(r.placed),
    paid: num(r.paid),
  }))
  return {
    period: periodInfo(p),
    steps: buildFunnel(
      FUNNEL_STEPS.map(s => ({ key: s.key, label: s.label, count: cur[s.key] })),
      prev
    ),
    byDevice: funnelBreakdown(ft, 'device'),
    byChannel: funnelBreakdown(ft, 'channel', ctx.selfHosts),
    paymentIntents: { started: num(intents?.started), committed: num(intents?.committed) },
    abandoned: {
      carts: carts.length,
      items: carts.reduce((s, r) => s + num(r.items), 0),
      value: carts.reduce((s, r) => s + num(r.value), 0),
      rows: carts.slice(0, 50).map(r => ({
        userId: r.user_id,
        email: r.email,
        name: r.name,
        items: num(r.items),
        value: num(r.value),
        lastAdded: new Date(r.last_added).toISOString(),
      })),
    },
  }
}

export async function productsReport(p: Period): Promise<ProductsData> {
  const b = istBounds(p)
  const [rows, wish, bis] = await Promise.all([
    queryMany(
      `WITH pv AS (
         SELECT product_id, COUNT(*)::int AS views, COUNT(DISTINCT COALESCE(user_id::text, session_id))::int AS uniq
         FROM product_views WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY product_id
       ),
       oi AS (
         SELECT oi.product_id, COUNT(DISTINCT oi.order_id)::int AS orders, COALESCE(SUM(oi.quantity), 0)::float8 AS units,
                COALESCE(SUM(oi.total_price), 0)::float8 AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE ${ORDER_RANGE} AND ${COUNTED} AND oi.product_id IS NOT NULL
         GROUP BY oi.product_id
       ),
       ca AS (
         SELECT product_id, COUNT(*)::int AS adds FROM cart_items
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY product_id
       ),
       ids AS (SELECT product_id FROM pv UNION SELECT product_id FROM oi UNION SELECT product_id FROM ca),
       wl AS (SELECT product_id, COUNT(*)::int AS n FROM wishlist_items WHERE product_id IN (SELECT product_id FROM ids) GROUP BY 1),
       bis AS (SELECT product_id, COUNT(*)::int AS n FROM back_in_stock_notify WHERE notified = false GROUP BY 1)
       SELECT p.id, p.name, p.slug, COALESCE(pv.views, 0) AS views, COALESCE(pv.uniq, 0) AS uniq,
              COALESCE(ca.adds, 0) AS adds, COALESCE(oi.orders, 0) AS orders, COALESCE(oi.units, 0) AS units,
              COALESCE(oi.revenue, 0) AS revenue, COALESCE(wl.n, 0) AS wish, COALESCE(bis.n, 0) AS waiting
       FROM ids JOIN products p ON p.id = ids.product_id
       LEFT JOIN pv USING (product_id) LEFT JOIN oi USING (product_id) LEFT JOIN ca USING (product_id)
       LEFT JOIN wl USING (product_id) LEFT JOIN bis USING (product_id)
       ORDER BY views DESC, revenue DESC
       LIMIT 500`,
      b
    ),
    queryMany(
      `SELECT w.product_id, p.name, COUNT(*)::int AS n FROM wishlist_items w JOIN products p ON p.id = w.product_id
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`
    ),
    queryMany(
      `SELECT b.product_id, p.name, COUNT(*)::int AS n FROM back_in_stock_notify b JOIN products p ON p.id = b.product_id
       WHERE b.notified = false GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`
    ),
  ])
  const products: ProductRow[] = rows.map(r => ({
    productId: r.id,
    name: r.name,
    slug: r.slug,
    views: num(r.views),
    uniqueViewers: num(r.uniq),
    cartAdds: num(r.adds),
    orders: num(r.orders),
    units: num(r.units),
    revenue: num(r.revenue),
    wishlisted: num(r.wish),
    waiting: num(r.waiting),
  }))
  return {
    period: periodInfo(p),
    products,
    ...productFlags(products),
    wishlisted: wish.map(r => ({ productId: r.product_id, name: r.name, count: num(r.n) })),
    backInStock: bis.map(r => ({ productId: r.product_id, name: r.name, count: num(r.n) })),
  }
}

export async function searchReport(p: Period): Promise<SearchData> {
  const b = istBounds(p)
  const [current, previous, terms, zero] = await Promise.all([
    searchTotals(p),
    searchTotals(previousPeriod(p)),
    queryMany(
      `WITH sl AS (
         SELECT LOWER(TRIM(query)) AS term, user_id, session_id, results_count, created_at FROM search_logs
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz AND LENGTH(TRIM(query)) >= 2
       ),
       top AS (SELECT term FROM sl GROUP BY term ORDER BY COUNT(*) DESC LIMIT 200),
       us AS (
         SELECT sl.term, sl.user_id, MIN(sl.created_at) AS at
         FROM sl JOIN top USING (term) WHERE sl.user_id IS NOT NULL AND sl.results_count > 0 GROUP BY 1, 2
       ),
       eng AS (
         SELECT us.term, us.user_id,
                EXISTS (SELECT 1 FROM product_views v WHERE v.user_id = us.user_id
                        AND v.created_at >= us.at AND v.created_at < us.at + INTERVAL '30 minutes') AS clicked,
                EXISTS (SELECT 1 FROM orders o WHERE o.user_id = us.user_id AND o.created_at >= us.at
                        AND o.created_at < us.at + INTERVAL '1 day' AND ${COUNTED}) AS ordered
         FROM us
       ),
       agg AS (
         SELECT sl.term, COUNT(*)::int AS searches, (COUNT(*) FILTER (WHERE sl.results_count = 0))::int AS zero,
                AVG(sl.results_count)::float8 AS avg_results,
                COUNT(DISTINCT COALESCE(sl.user_id::text, sl.session_id))::int AS searchers,
                COUNT(DISTINCT sl.user_id)::int AS signed_in
         FROM sl JOIN top USING (term) GROUP BY sl.term
       )
       SELECT agg.*, COALESCE(e.clicked, 0)::int AS clicked, COALESCE(e.ordered, 0)::int AS ordered
       FROM agg LEFT JOIN (
         SELECT term, COUNT(*) FILTER (WHERE clicked) AS clicked, COUNT(*) FILTER (WHERE ordered) AS ordered FROM eng GROUP BY term
       ) e USING (term)
       ORDER BY agg.searches DESC`,
      b
    ),
    queryMany(
      `SELECT LOWER(TRIM(query)) AS term, COUNT(*)::int AS searches, MAX(created_at) AS last_at FROM search_logs
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz AND results_count = 0 AND LENGTH(TRIM(query)) >= 2
       GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
      b
    ),
  ])
  const all: SearchTerm[] = terms.map(r => ({
    term: r.term,
    searches: num(r.searches),
    zeroResults: num(r.zero),
    avgResults: Math.round(num(r.avg_results) * 10) / 10,
    searchers: num(r.searchers),
    signedInSearchers: num(r.signed_in),
    clickedSearchers: num(r.clicked),
    orderedSearchers: num(r.ordered),
  }))
  return {
    period: periodInfo(p),
    current,
    previous,
    terms: all.slice(0, 100),
    zeroTerms: zero.map(r => ({ term: r.term, searches: num(r.searches), lastSearched: new Date(r.last_at).toISOString() })),
    noEngagement: all
      .filter(t => t.searches > t.zeroResults && t.signedInSearchers > 0 && t.clickedSearchers === 0 && t.orderedSearchers === 0)
      .slice(0, 50),
  }
}

export async function audienceReport(p: Period): Promise<AudienceData> {
  const b = istBounds(p)
  const [ua, nr, li, states, cities] = await Promise.all([
    queryMany(
      `WITH ${SESSION_CTES}
       SELECT s.ua, COUNT(*)::int AS sessions, (COUNT(*) FILTER (WHERE c.orders > 0))::int AS converted
       FROM sess s LEFT JOIN sconv c USING (session_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 5000`,
      b
    ),
    queryMany(
      `WITH ${SESSION_CTES}${NEW_CTES}
       SELECT CASE WHEN n.is_new THEN 'New' ELSE 'Returning' END AS key, COUNT(*)::int AS sessions,
              (COUNT(*) FILTER (WHERE c.orders > 0))::int AS converted
       FROM sess s JOIN snew n USING (session_id) LEFT JOIN sconv c USING (session_id) GROUP BY 1`,
      b
    ),
    queryMany(
      `WITH ${SESSION_CTES}
       SELECT CASE WHEN s.user_key IS NOT NULL THEN 'Signed in' ELSE 'Guest' END AS key, COUNT(*)::int AS sessions,
              (COUNT(*) FILTER (WHERE c.orders > 0))::int AS converted
       FROM sess s LEFT JOIN sconv c USING (session_id) GROUP BY 1`,
      b
    ),
    queryMany(
      `SELECT INITCAP(TRIM(COALESCE(NULLIF(o.shipping_address_snapshot->>'state', ''), a.state))) AS key,
              COUNT(*)::int AS orders, COALESCE(SUM(o.total_amount), 0)::float8 AS revenue
       FROM orders o LEFT JOIN addresses a ON a.id = o.shipping_address_id
       WHERE ${ORDER_RANGE} AND ${COUNTED}
       GROUP BY 1 HAVING INITCAP(TRIM(COALESCE(NULLIF(o.shipping_address_snapshot->>'state', ''), a.state))) IS NOT NULL
       ORDER BY 2 DESC LIMIT 20`,
      b
    ),
    queryMany(
      `SELECT INITCAP(TRIM(COALESCE(NULLIF(o.shipping_address_snapshot->>'city', ''), a.city))) AS key,
              COUNT(*)::int AS orders, COALESCE(SUM(o.total_amount), 0)::float8 AS revenue
       FROM orders o LEFT JOIN addresses a ON a.id = o.shipping_address_id
       WHERE ${ORDER_RANGE} AND ${COUNTED}
       GROUP BY 1 HAVING INITCAP(TRIM(COALESCE(NULLIF(o.shipping_address_snapshot->>'city', ''), a.city))) IS NOT NULL
       ORDER BY 2 DESC LIMIT 20`,
      b
    ),
  ])
  const uaRows: UaTuple[] = ua.map(r => ({ ua: r.ua, sessions: num(r.sessions), converted: num(r.converted) }))
  const share = (rows: any[]) => rows.map(r => ({ key: r.key, sessions: num(r.sessions), convertedSessions: num(r.converted) }))
  const geo = (rows: any[]) => rows.map(r => ({ key: r.key, orders: num(r.orders), revenue: num(r.revenue) }))
  return {
    period: periodInfo(p),
    devices: uaShares(uaRows, 'device', true),
    browsers: uaShares(uaRows, 'browser'),
    os: uaShares(uaRows, 'os'),
    newReturning: share(nr),
    loggedIn: share(li),
    states: geo(states),
    cities: geo(cities),
  }
}

export async function realtimeReport(ctx: ReportContext): Promise<RealtimeData> {
  const [sessions, perMinute, orders] = await Promise.all([
    queryMany(
      `SELECT session_id,
              (array_agg(path ORDER BY created_at DESC))[1] AS path,
              (array_agg(page ORDER BY created_at DESC))[1] AS page,
              (array_agg(user_agent ORDER BY created_at))[1] AS ua,
              LOWER(NULLIF((array_agg(utm_source ORDER BY created_at))[1], '')) AS source,
              LOWER(NULLIF((array_agg(utm_medium ORDER BY created_at))[1], '')) AS medium,
              NULLIF((array_agg(utm_campaign ORDER BY created_at))[1], '') AS campaign,
              bool_or(COALESCE(gclid, gbraid, wbraid) IS NOT NULL) AS gclick,
              LOWER(regexp_replace(substring((array_agg(referrer ORDER BY created_at))[1] from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'), '^www\\.', '')) AS ref_host,
              COUNT(*)::int AS pv, MIN(created_at) AS started, MAX(created_at) AS last_seen
       FROM page_events WHERE created_at >= NOW() - INTERVAL '30 minutes'
       GROUP BY session_id ORDER BY last_seen DESC LIMIT 500`
    ),
    queryMany(
      `SELECT to_char(date_trunc('minute', created_at AT TIME ZONE 'Asia/Kolkata'), 'HH24:MI') AS minute, COUNT(*)::int AS views
       FROM page_events WHERE created_at >= NOW() - INTERVAL '30 minutes' GROUP BY 1 ORDER BY 1`
    ),
    queryMany(
      `SELECT o.id, o.order_number, o.total_amount::float8 AS total, o.status, o.payment_status, o.created_at,
              CASE WHEN COALESCE(o.gclid, o.gbraid, o.wbraid) IS NOT NULL THEN 'Google Ads'
                   ELSE COALESCE(NULLIF(LOWER(o.utm_source), ''), o.source) END AS source
       FROM orders o WHERE o.created_at >= NOW() - INTERVAL '1 hour' ORDER BY o.created_at DESC LIMIT 50`
    ),
  ])
  const rows = sessions.map(r => {
    const g = classifyChannel(
      { source: r.source, medium: r.medium, campaign: r.campaign, googleClick: !!r.gclick, referrerHost: r.ref_host },
      ctx.selfHosts
    )
    return {
      sessionId: r.session_id,
      path: r.path,
      page: r.page,
      source: r.source || r.gclick ? sourceLabel({ source: r.source, googleClick: !!r.gclick }) : g === 'direct' ? 'Direct' : r.ref_host,
      channel: CHANNEL_GROUPS.find(c => c.id === g)!.label,
      device: parseUserAgent(r.ua).device,
      pageviews: num(r.pv),
      lastSeen: new Date(r.last_seen).toISOString(),
      startedAt: new Date(r.started).toISOString(),
    }
  })
  const tally = (f: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  }
  return {
    at: new Date().toISOString(),
    activeSessions: rows.length,
    pageviews: rows.reduce((s, r) => s + r.pageviews, 0),
    perMinute: perMinute.map(r => ({ minute: r.minute, views: num(r.views) })),
    sessions: rows.slice(0, 100),
    pages: tally(r => r.path).map(([path, sessions]) => ({ path, sessions })),
    sources: tally(r => r.channel).map(([key, sessions]) => ({ key, sessions })),
    orders: orders.map(r => ({
      id: r.id,
      orderNumber: r.order_number,
      total: num(r.total),
      status: r.status,
      paymentStatus: r.payment_status,
      createdAt: new Date(r.created_at).toISOString(),
      source: r.source ?? '-',
    })),
  }
}

export async function trafficReport<T extends TrafficTab>(tab: T, p: Period, ctx: ReportContext): Promise<TrafficTabData[T]> {
  const run: { [K in TrafficTab]: () => Promise<TrafficTabData[K]> } = {
    overview: () => overviewReport(p, ctx),
    acquisition: () => acquisitionReport(p, ctx),
    behaviour: () => behaviourReport(p),
    funnel: () => funnelReport(p, ctx),
    products: () => productsReport(p),
    search: () => searchReport(p),
    audience: () => audienceReport(p),
    realtime: () => realtimeReport(ctx),
  }
  return run[tab]() as Promise<TrafficTabData[T]>
}
