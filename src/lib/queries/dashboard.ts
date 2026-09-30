import { queryOne, queryMany, queryCount, type AnalyticsRange } from './shared'
import { getDashboardInsights, rangeDays, type DashboardInsights } from '../dashboard-insights'
import { DashboardStats } from '@/types'

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const [
      totalProducts,
      totalOrders,
      revenueResult,
      totalCustomers,
      lowStockProducts,
      pendingOrders,
      newCustomersThisMonth,
    ] = await Promise.all([
      queryCount('SELECT COUNT(*) FROM products'),
      queryCount('SELECT COUNT(*) FROM orders'),
      queryOne<{ total: string; online: string; offline: string }>(
        `
        SELECT
          COALESCE(SUM(total_amount), 0) AS total,
          COALESCE(SUM(CASE WHEN source = 'online' THEN total_amount ELSE 0 END), 0) AS online,
          COALESCE(SUM(CASE WHEN source = 'offline' THEN total_amount ELSE 0 END), 0) AS offline
        FROM orders WHERE payment_status = $1
      `,
        ['paid']
      ),
      queryCount('SELECT COUNT(*) FROM users WHERE is_active = $1 AND is_guest = $2', [true, false]),
      queryCount("SELECT COUNT(*) FROM products WHERE stock_status = 'Low Stock'"),
      queryCount('SELECT COUNT(*) FROM orders WHERE status = $1', ['pending']),
      queryCount(
        "SELECT COUNT(*) FROM users WHERE is_active = TRUE AND is_guest = FALSE AND created_at >= date_trunc('month', NOW())"
      ),
    ])

    const [onlineOrders, offlineOrders] = await Promise.all([
      queryCount("SELECT COUNT(*) FROM orders WHERE source = 'online'"),
      queryCount("SELECT COUNT(*) FROM orders WHERE source = 'offline'"),
    ])

    return {
      totalProducts,
      totalOrders,
      onlineOrders,
      offlineOrders,
      totalRevenue: parseFloat(revenueResult?.total || '0'),
      onlineRevenue: parseFloat(revenueResult?.online || '0'),
      offlineRevenue: parseFloat(revenueResult?.offline || '0'),
      totalCustomers,
      newCustomersThisMonth,
      lowStockProducts,
      pendingOrders,
    }
  } catch {
    return {
      totalProducts: 0,
      totalOrders: 0,
      onlineOrders: 0,
      offlineOrders: 0,
      totalRevenue: 0,
      onlineRevenue: 0,
      offlineRevenue: 0,
      totalCustomers: 0,
      newCustomersThisMonth: 0,
      lowStockProducts: 0,
      pendingOrders: 0,
    }
  }
}


export async function getDashboardMetrics() {
  const [periodRevenue, orderFunnel, topProducts, recentOrders] = await Promise.all([
    queryOne<{
      this_month_revenue: string
      last_month_revenue: string
      this_month_orders: string
      last_month_orders: string
      this_month_customers: string
      last_month_customers: string
      today_revenue: string
      yesterday_revenue: string
      online_revenue: string
      offline_revenue: string
    }>(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', NOW()) AND payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS this_month_revenue,
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', NOW() - INTERVAL '1 month') AND created_at < date_trunc('month', NOW()) AND payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS last_month_revenue,
        COUNT(CASE WHEN created_at >= date_trunc('month', NOW()) THEN 1 END) AS this_month_orders,
        COUNT(CASE WHEN created_at >= date_trunc('month', NOW() - INTERVAL '1 month') AND created_at < date_trunc('month', NOW()) THEN 1 END) AS last_month_orders,
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', NOW()) AND payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS today_revenue,
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', NOW() - INTERVAL '1 day') AND created_at < date_trunc('day', NOW()) AND payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS yesterday_revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' AND source = 'online' THEN total_amount ELSE 0 END), 0) AS online_revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' AND source = 'offline' THEN total_amount ELSE 0 END), 0) AS offline_revenue
      FROM orders
    `),
    queryOne<{
      pending: string
      processing: string
      shipped: string
      out_for_delivery: string
      delivered: string
      cancelled: string
    }>(`
      SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN status IN ('confirmed','processing') THEN 1 END) AS processing,
        COUNT(CASE WHEN status = 'shipped' THEN 1 END) AS shipped,
        COUNT(CASE WHEN status = 'out_for_delivery' THEN 1 END) AS out_for_delivery,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled
      FROM orders
    `),
    queryMany<{ product_id: string; name: string; total_qty: string; total_revenue: string }>(`
      SELECT
        oi.product_id,
        p.name,
        SUM(oi.quantity) AS total_qty,
        SUM(oi.total_price) AS total_revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= date_trunc('month', NOW())
      GROUP BY oi.product_id, p.name
      ORDER BY total_qty DESC
      LIMIT 5
    `),
    queryMany(`
      SELECT
        o.id, o.order_number, o.customer_name, o.total_amount,
        o.status, o.payment_status, o.source, o.created_at,
        json_build_object(
          'id', u.id, 'email', u.email,
          'first_name', u.first_name, 'last_name', u.last_name
        ) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
      LIMIT 5
    `),
  ])

  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100))

  const thisRevenue = parseFloat(periodRevenue?.this_month_revenue || '0')
  const lastRevenue = parseFloat(periodRevenue?.last_month_revenue || '0')
  const thisOrders = parseInt(periodRevenue?.this_month_orders || '0')
  const lastOrders = parseInt(periodRevenue?.last_month_orders || '0')
  const todayRevenue = parseFloat(periodRevenue?.today_revenue || '0')
  const yesterdayRevenue = parseFloat(periodRevenue?.yesterday_revenue || '0')
  const onlineRevenue = parseFloat(periodRevenue?.online_revenue || '0')
  const offlineRevenue = parseFloat(periodRevenue?.offline_revenue || '0')

  return {
    revenue: {
      thisMonth: thisRevenue,
      lastMonth: lastRevenue,
      pctChange: pct(thisRevenue, lastRevenue),
      today: todayRevenue,
      yesterday: yesterdayRevenue,
      todayPct: pct(todayRevenue, yesterdayRevenue),
      online: onlineRevenue,
      offline: offlineRevenue,
      total: onlineRevenue + offlineRevenue,
    },
    orders: {
      thisMonth: thisOrders,
      lastMonth: lastOrders,
      pctChange: pct(thisOrders, lastOrders),
    },
    funnel: {
      pending: parseInt(orderFunnel?.pending || '0'),
      processing: parseInt(orderFunnel?.processing || '0'),
      shipped: parseInt(orderFunnel?.shipped || '0'),
      outForDelivery: parseInt(orderFunnel?.out_for_delivery || '0'),
      delivered: parseInt(orderFunnel?.delivered || '0'),
      cancelled: parseInt(orderFunnel?.cancelled || '0'),
    },
    topProducts: topProducts.map(p => ({
      id: p.product_id,
      name: p.name,
      qty: parseInt(p.total_qty),
      revenue: parseFloat(p.total_revenue),
    })),
    recentOrders,
  }
}


function rangeConfig(range: AnalyticsRange): {
  interval: string
  bucket: 'hour' | 'day' | 'week' | 'month'
  label: string
} {
  switch (range) {
    case 'today':
      return { interval: '1 day', bucket: 'hour', label: 'Today' }
    case '7d':
      return { interval: '7 days', bucket: 'day', label: 'Last 7 days' }
    case '30d':
      return { interval: '30 days', bucket: 'day', label: 'Last 30 days' }
    case '90d':
      return { interval: '90 days', bucket: 'week', label: 'Last 90 days' }
    case 'month':
      return { interval: '1 month', bucket: 'day', label: 'This month' }
    case 'year':
      return { interval: '1 year', bucket: 'month', label: 'Last 12 months' }
    default:
      return { interval: '30 days', bucket: 'day', label: 'Last 30 days' }
  }
}

const num = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0)
const int = (v: unknown) => (v == null ? 0 : parseInt(String(v), 10) || 0)
const pctDelta = (a: number, b: number): number | null => (b === 0 ? null : Math.round(((a - b) / b) * 100))

export interface DashboardAnalytics {
  range: AnalyticsRange
  rangeLabel: string
  kpis: {
    revenue: number
    revenuePrev: number
    revenuePct: number | null
    orders: number
    ordersPrev: number
    ordersPct: number | null
    aov: number
    aovPrev: number
    aovPct: number | null
    customers: number
    customersPrev: number
    customersPct: number | null
  }
  trend: {
    bucket: string
    label: string
    revenue: number
    orders: number
    paidOrders: number
    customers: number
    units: number
    aov: number
  }[]
  trendBucket: 'hour' | 'day' | 'week' | 'month'
  payment: { online: number; cod: number; other: number; codOutstanding: number; codOutstandingCount: number }
  topCategories: { name: string; units: number; revenue: number }[]
  topBrands: { name: string; units: number; revenue: number }[]
  customerSplit: { newCustomers: number; returningCustomers: number }
  buyerSplit: { business: number; consumer: number; businessRevenue: number; consumerRevenue: number }
  inventory: { inStock: number; lowStock: number; outOfStock: number; stockValue: number }
  returns: { total: number; rtoInTransit: number; rtoDelivered: number }
  insights: DashboardInsights
}

/**
 * Range-aware commerce analytics for the admin dashboard. Only counts revenue on
 * paid orders; order counts include all statuses. Compares to the immediately
 * preceding equal-length window for deltas. All columns verified against schema.
 */
export async function getDashboardAnalytics(range: AnalyticsRange = '30d'): Promise<DashboardAnalytics> {
  const { interval, bucket, label } = rangeConfig(range)
  // For 'month'/'year' anchor to calendar boundaries; else rolling window.
  const startExpr =
    range === 'month'
      ? `date_trunc('month', NOW())`
      : range === 'year'
        ? `date_trunc('month', NOW()) - INTERVAL '11 months'`
        : `NOW() - INTERVAL '${interval}'`
  const prevStartExpr =
    range === 'month'
      ? `date_trunc('month', NOW() - INTERVAL '1 month')`
      : range === 'year'
        ? `date_trunc('month', NOW()) - INTERVAL '23 months'`
        : `NOW() - INTERVAL '${interval}' - INTERVAL '${interval}'`
  const prevEndExpr = range === 'month' ? `date_trunc('month', NOW())` : `NOW() - INTERVAL '${interval}'`

  const kpiPromise = queryOne<Record<string, string>>(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE created_at >= ${startExpr} AND payment_status = 'paid'), 0) AS rev,
        COALESCE(SUM(total_amount) FILTER (WHERE created_at >= ${prevStartExpr} AND created_at < ${prevEndExpr} AND payment_status = 'paid'), 0) AS rev_prev,
        COUNT(*) FILTER (WHERE created_at >= ${startExpr}) AS ord,
        COUNT(*) FILTER (WHERE created_at >= ${prevStartExpr} AND created_at < ${prevEndExpr}) AS ord_prev,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= ${startExpr}) AS cust,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= ${prevStartExpr} AND created_at < ${prevEndExpr}) AS cust_prev
      FROM orders
    `)
  const paidRevenue = kpiPromise.then(r => ({ revenue: num(r?.rev), revenuePrev: num(r?.rev_prev) }))

  const [kpiRow, trendRows, payRow, topCats, topBrandsRows, custSplit, buyerRow, invRow, retRow, insights] =
    await Promise.all([
      kpiPromise,
      // Trend series over the range. Two aggregations joined by bucket so the
      // order_items fan-out doesn't inflate order-level sums (revenue/counts).
      queryMany<Record<string, string>>(`
      WITH ord AS (
        SELECT date_trunc('${bucket}', created_at) AS bucket,
               COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) AS revenue,
               COUNT(*) AS orders,
               COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               COUNT(DISTINCT user_id) AS customers
        FROM orders WHERE created_at >= ${startExpr}
        GROUP BY 1
      ),
      itm AS (
        SELECT date_trunc('${bucket}', o.created_at) AS bucket, COALESCE(SUM(oi.quantity), 0) AS units
        FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.created_at >= ${startExpr}
        GROUP BY 1
      )
      SELECT ord.bucket, ord.revenue, ord.orders, ord.paid_orders, ord.customers,
             COALESCE(itm.units, 0) AS units
      FROM ord LEFT JOIN itm ON itm.bucket = ord.bucket
      ORDER BY ord.bucket ASC
    `),
      // Payment split + COD outstanding
      queryOne<Record<string, string>>(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid' AND payment_mode NOT ILIKE '%cod%'), 0) AS online,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid' AND payment_mode ILIKE '%cod%'), 0) AS cod,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid' AND payment_mode IS NULL), 0) AS other,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_mode ILIKE '%cod%' AND payment_status <> 'paid' AND status NOT IN ('cancelled','returned')), 0) AS cod_outstanding,
        COUNT(*) FILTER (WHERE payment_mode ILIKE '%cod%' AND payment_status <> 'paid' AND status NOT IN ('cancelled','returned')) AS cod_outstanding_count
      FROM orders
      WHERE created_at >= ${startExpr}
    `),
      // Top categories
      queryMany<Record<string, string>>(`
      SELECT c.name AS name, SUM(oi.quantity) AS units, SUM(oi.total_price) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE o.created_at >= ${startExpr}
      GROUP BY c.name ORDER BY revenue DESC LIMIT 6
    `),
      // Top brands
      queryMany<Record<string, string>>(`
      SELECT b.name AS name, SUM(oi.quantity) AS units, SUM(oi.total_price) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      JOIN brands b ON b.id = p.brand_id
      WHERE o.created_at >= ${startExpr}
      GROUP BY b.name ORDER BY revenue DESC LIMIT 6
    `),
      // New vs returning customers in range (based on first-ever order date)
      queryOne<Record<string, string>>(`
      WITH firsts AS (
        SELECT user_id, MIN(created_at) AS first_order FROM orders WHERE user_id IS NOT NULL GROUP BY user_id
      ), in_range AS (
        SELECT DISTINCT o.user_id FROM orders o WHERE o.created_at >= ${startExpr} AND o.user_id IS NOT NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE f.first_order >= ${startExpr}) AS new_cust,
        COUNT(*) FILTER (WHERE f.first_order < ${startExpr}) AS returning_cust
      FROM in_range ir JOIN firsts f ON f.user_id = ir.user_id
    `),
      // Business vs consumer (by orders in range; B2B = GSTIN present or business discount)
      queryOne<Record<string, string>>(`
      SELECT
        COUNT(*) FILTER (WHERE buyer_gstin IS NOT NULL AND buyer_gstin <> '' OR business_discount_amount > 0) AS business,
        COUNT(*) FILTER (WHERE (buyer_gstin IS NULL OR buyer_gstin = '') AND business_discount_amount = 0) AS consumer,
        COALESCE(SUM(total_amount) FILTER (WHERE (buyer_gstin IS NOT NULL AND buyer_gstin <> '') OR business_discount_amount > 0), 0) AS business_rev,
        COALESCE(SUM(total_amount) FILTER (WHERE (buyer_gstin IS NULL OR buyer_gstin = '') AND business_discount_amount = 0), 0) AS consumer_rev
      FROM orders WHERE created_at >= ${startExpr} AND payment_status = 'paid'
    `),
      // Inventory health (active products) + real stock value from variants/sub-variants
      queryOne<Record<string, string>>(`
      SELECT
        COUNT(*) FILTER (WHERE stock_status = 'In Stock') AS in_stock,
        COUNT(*) FILTER (WHERE stock_status = 'Low Stock') AS low_stock,
        COUNT(*) FILTER (WHERE stock_status = 'Out of Stock') AS out_of_stock,
        COALESCE((
          SELECT SUM(
            COALESCE(pv.inventory_quantity, 0) *
            COALESCE(NULLIF(pv.cost_price,0), NULLIF(pv.price,0), NULLIF(p2.cost_price,0), NULLIF(p2.base_price,0), 0)
          )
          FROM product_variants pv
          JOIN products p2 ON p2.id = pv.product_id
          WHERE p2.is_active = true AND pv.is_active = true
            AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
        ), 0) +
        COALESCE((
          SELECT SUM(
            COALESCE(sv.inventory_quantity, 0) *
            COALESCE(NULLIF(sv.price,0), NULLIF(p3.cost_price,0), NULLIF(p3.base_price,0), 0)
          )
          FROM product_sub_variants sv
          JOIN product_variants pv2 ON pv2.id = sv.variant_id
          JOIN products p3 ON p3.id = pv2.product_id
          WHERE p3.is_active = true AND sv.is_active = true
        ), 0) +
        COALESCE((
          SELECT SUM(
            COALESCE(inventory_quantity, 0) *
            COALESCE(NULLIF(cost_price,0), NULLIF(base_price,0), 0)
          )
          FROM products
          WHERE is_active = true AND has_variants = false
        ), 0) AS stock_value
      FROM products WHERE is_active = true
    `),
      // Returns / RTO
      queryOne<Record<string, string>>(`
      SELECT
        (SELECT COUNT(*) FROM return_requests WHERE created_at >= ${startExpr}) AS total_returns,
        COUNT(*) FILTER (WHERE shipment_status IN ('rto_initiated','rto_in_transit','rto_out_for_return')) AS rto_in_transit,
        COUNT(*) FILTER (WHERE shipment_status = 'rto_delivered') AS rto_delivered
      FROM orders WHERE created_at >= ${startExpr}
    `),
      getDashboardInsights({ startExpr, prevStartExpr, prevEndExpr, days: rangeDays(range) }, paidRevenue),
    ])

  const rev = num(kpiRow?.rev),
    revPrev = num(kpiRow?.rev_prev)
  const ord = int(kpiRow?.ord),
    ordPrev = int(kpiRow?.ord_prev)
  const cust = int(kpiRow?.cust),
    custPrev = int(kpiRow?.cust_prev)
  const aov = ord > 0 ? rev / ord : 0
  const aovPrev = ordPrev > 0 ? revPrev / ordPrev : 0

  return {
    range,
    rangeLabel: label,
    trendBucket: bucket,
    kpis: {
      revenue: rev,
      revenuePrev: revPrev,
      revenuePct: pctDelta(rev, revPrev),
      orders: ord,
      ordersPrev: ordPrev,
      ordersPct: pctDelta(ord, ordPrev),
      aov: Math.round(aov),
      aovPrev: Math.round(aovPrev),
      aovPct: pctDelta(aov, aovPrev),
      customers: cust,
      customersPrev: custPrev,
      customersPct: pctDelta(cust, custPrev),
    },
    trend: trendRows.map(r => {
      const revenue = num(r.revenue)
      const paidOrders = int(r.paid_orders)
      return {
        bucket: String(r.bucket),
        label: String(r.bucket),
        revenue,
        orders: int(r.orders),
        paidOrders,
        customers: int(r.customers),
        units: int(r.units),
        aov: paidOrders > 0 ? Math.round(revenue / paidOrders) : 0,
      }
    }),
    payment: {
      online: num(payRow?.online),
      cod: num(payRow?.cod),
      other: num(payRow?.other),
      codOutstanding: num(payRow?.cod_outstanding),
      codOutstandingCount: int(payRow?.cod_outstanding_count),
    },
    topCategories: topCats.map(c => ({
      name: c.name || 'Uncategorized',
      units: num(c.units),
      revenue: num(c.revenue),
    })),
    topBrands: topBrandsRows.map(b => ({ name: b.name || 'No brand', units: num(b.units), revenue: num(b.revenue) })),
    customerSplit: { newCustomers: int(custSplit?.new_cust), returningCustomers: int(custSplit?.returning_cust) },
    buyerSplit: {
      business: int(buyerRow?.business),
      consumer: int(buyerRow?.consumer),
      businessRevenue: num(buyerRow?.business_rev),
      consumerRevenue: num(buyerRow?.consumer_rev),
    },
    inventory: {
      inStock: int(invRow?.in_stock),
      lowStock: int(invRow?.low_stock),
      outOfStock: int(invRow?.out_of_stock),
      stockValue: num(invRow?.stock_value),
    },
    returns: {
      total: int(retRow?.total_returns),
      rtoInTransit: int(retRow?.rto_in_transit),
      rtoDelivered: int(retRow?.rto_delivered),
    },
    insights,
  }
}

// Monthly paid-revenue trend split by order source (last 12 months). Pivoted server-side into
// one continuous (zero-filled) points array per source, aligned to a shared months axis.
