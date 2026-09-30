import { queryOne, queryMany } from '@/lib/shared/db'
import type { AnalyticsRange } from '@/lib/queries'

export interface RangeWindow {
  startExpr: string
  prevStartExpr: string
  prevEndExpr: string
  days: number
}

export interface DashboardInsights {
  money: {
    cogs: number
    gross: number
    grossPrev: number
    grossPct: number | null
    marginPct: number | null
    marginPctPrev: number | null
    costCoveragePct: number | null
    units: number
    unitsPrev: number
    unitsPct: number | null
  }
  conversion: {
    sessions: number
    sessionsPrev: number
    productViews: number
    productViewsPrev: number
    paidOrders: number
    paidOrdersPrev: number
    rate: number | null
    ratePrev: number | null
    ratePct: number | null
  }
  fulfilment: {
    avgHoursToShip: number | null
    avgHoursToShipPrev: number | null
    avgDaysToDeliver: number | null
    onTimePct: number | null
    etaSample: number
    cancelRate: number | null
    cancelRatePrev: number | null
    returnRate: number | null
    returnsInRange: number
    guestShare: number | null
  }
  attention: {
    pendingOver24h: number
    unshippedOver48h: number
    deliveryAttempted: number
    cancelRequested: number
    unpaidOnline: number
    unpaidOnlineAmount: number
    openReturns: number
    pendingReviews: number
    backInStockWaitlist: number
    supportOpen: number
    overdueTasks: number
    openTasks: number
    pendingRfqs: number
    churnHigh: number
    expiringBatches: number
    expiredBatches: number
    sellingButOut: number
    restockSoon: number
    overdueBills: number
  }
  promotions: {
    discountTotal: number
    discountPctOfRevenue: number | null
    discountedOrders: number
    couponUses: number
    couponDiscount: number
    topCoupons: { code: string; uses: number; discount: number }[]
  }
  carts: {
    activeCarts: number
    cartValue: number
    abandonedCarts: number
    abandonedValue: number
    savedForLater: number
  }
  engagement: {
    wishlistAdds: number
    newReviews: number
    avgRating: number | null
    avgRatingAll: number | null
    lowRatingReviews: number
    searches: number
    zeroResultSearches: number
    topZeroSearches: { query: string; count: number }[]
    supportInRange: number
    supportResolutionHours: number | null
    signups: number
    signupsPrev: number
    signupsPct: number | null
  }
  health: { healthy: number; rising: number; high: number; avgScore: number | null }
  catalog: {
    activeProducts: number
    draftProducts: number
    newProducts: number
    productsSold: number
    slowMovers: number
    slowMoverValue: number
    expiringQty: number
  }
  topViewed: { id: string; name: string; views: number; units: number; revenue: number; conversion: number | null }[]
  marginByProduct: { id: string; name: string; revenue: number; units: number; marginPct: number | null }[]
  cash: {
    gstCollected: number
    shippingCharged: number
    shippingCost: number
    shippedViaDelhivery: number
    codFees: number
    cashSales: number
    cashSalesValue: number
    expenses: number
    overdueBillsAmount: number
    openQuotes: number
    openQuotesValue: number
    openPos: number
    openPosValue: number
  }
  byHour: number[]
  trafficByHour: number[]
  bySource: { source: string; orders: number; revenue: number }[]
  topStates: { state: string; orders: number; revenue: number }[]
}

const num = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0)
const int = (v: unknown) => (v == null ? 0 : parseInt(String(v), 10) || 0)
const nullable = (v: unknown) => (v == null ? null : parseFloat(String(v)))
const pctDelta = (a: number, b: number): number | null => (b === 0 ? null : Math.round(((a - b) / b) * 100))
const ratio = (a: number, b: number, digits = 1): number | null =>
  b > 0 ? Number(((a / b) * 100).toFixed(digits)) : null
const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)
const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100)

export function rangeDays(range: AnalyticsRange): number {
  switch (range) {
    case 'today':
      return 1
    case '7d':
      return 7
    case '90d':
      return 90
    case 'month':
      return Math.max(1, new Date().getDate())
    case 'year':
      return 365
    default:
      return 30
  }
}

type PaidRevenue = { revenue: number; revenuePrev: number }

export async function getDashboardInsights(
  w: RangeWindow,
  paid: PaidRevenue | Promise<PaidRevenue>
): Promise<DashboardInsights> {
  const { startExpr, prevStartExpr, prevEndExpr } = w
  const days = Math.max(1, Math.floor(w.days))
  const prevWindow = `created_at >= ${prevStartExpr} AND created_at < ${prevEndExpr}`

  const [
    money,
    conv,
    ful,
    ret,
    promo,
    coupons,
    cart,
    eng,
    zero,
    health,
    cat,
    viewed,
    margins,
    hours,
    traffic,
    sources,
    states,
    cash,
  ] = await Promise.all([
    queryOne<Record<string, string>>(`
      WITH items AS (
        SELECT o.created_at, o.payment_status, oi.quantity,
               COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0), 0) AS unit_cost
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN products p ON p.id = oi.product_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         WHERE o.created_at >= ${prevStartExpr} AND o.status <> 'cancelled'
      )
      SELECT
        COALESCE(SUM(quantity * unit_cost) FILTER (WHERE created_at >= ${startExpr} AND payment_status = 'paid'), 0) AS cogs,
        COALESCE(SUM(quantity * unit_cost) FILTER (WHERE ${prevWindow} AND payment_status = 'paid'), 0) AS cogs_prev,
        COALESCE(SUM(quantity) FILTER (WHERE created_at >= ${startExpr} AND payment_status = 'paid'), 0) AS paid_units,
        COALESCE(SUM(quantity) FILTER (WHERE created_at >= ${startExpr} AND payment_status = 'paid' AND unit_cost > 0), 0) AS costed_units,
        COALESCE(SUM(quantity) FILTER (WHERE created_at >= ${startExpr}), 0) AS units,
        COALESCE(SUM(quantity) FILTER (WHERE ${prevWindow}), 0) AS units_prev
      FROM items
    `),
    queryOne<Record<string, string>>(`
      SELECT
        (SELECT COUNT(DISTINCT session_id) FROM page_events WHERE created_at >= ${startExpr}) AS sessions,
        (SELECT COUNT(DISTINCT session_id) FROM page_events WHERE ${prevWindow}) AS sessions_prev,
        (SELECT COUNT(*) FROM product_views WHERE created_at >= ${startExpr}) AS product_views,
        (SELECT COUNT(*) FROM product_views WHERE ${prevWindow}) AS product_views_prev,
        (SELECT COUNT(*) FROM orders WHERE created_at >= ${startExpr} AND payment_status = 'paid') AS paid_orders,
        (SELECT COUNT(*) FROM orders WHERE ${prevWindow} AND payment_status = 'paid') AS paid_orders_prev,
        (SELECT COUNT(*) FROM orders WHERE created_at >= ${startExpr} AND payment_status = 'paid' AND COALESCE(source, 'online') = 'online') AS online_paid,
        (SELECT COUNT(*) FROM orders WHERE ${prevWindow} AND payment_status = 'paid' AND COALESCE(source, 'online') = 'online') AS online_paid_prev
    `),
    queryOne<Record<string, string>>(`
      SELECT
        AVG(EXTRACT(EPOCH FROM (shipped_at - created_at)) / 3600) FILTER (WHERE shipped_at > created_at AND COALESCE(source, 'online') = 'online' AND created_at >= ${startExpr}) AS ship_hours,
        AVG(EXTRACT(EPOCH FROM (shipped_at - created_at)) / 3600) FILTER (WHERE shipped_at > created_at AND COALESCE(source, 'online') = 'online' AND ${prevWindow}) AS ship_hours_prev,
        AVG(EXTRACT(EPOCH FROM (delivered_at - shipped_at)) / 86400) FILTER (WHERE delivered_at > shipped_at AND COALESCE(source, 'online') = 'online' AND created_at >= ${startExpr}) AS deliver_days,
        COUNT(*) FILTER (WHERE delivered_at IS NOT NULL AND estimated_delivery_date IS NOT NULL AND created_at >= ${startExpr}) AS eta_total,
        COUNT(*) FILTER (WHERE delivered_at IS NOT NULL AND estimated_delivery_date IS NOT NULL AND delivered_at::date <= estimated_delivery_date AND created_at >= ${startExpr}) AS eta_on_time,
        COUNT(*) FILTER (WHERE created_at >= ${startExpr}) AS orders_cur,
        COUNT(*) FILTER (WHERE created_at >= ${startExpr} AND status = 'cancelled') AS cancelled_cur,
        COUNT(*) FILTER (WHERE ${prevWindow}) AS orders_prev,
        COUNT(*) FILTER (WHERE ${prevWindow} AND status = 'cancelled') AS cancelled_prev,
        COUNT(*) FILTER (WHERE created_at >= ${startExpr} AND status = 'delivered') AS delivered_cur,
        COUNT(*) FILTER (WHERE created_at >= ${startExpr} AND user_id IS NULL) AS guest_cur,
        COUNT(*) FILTER (WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours') AS pending_over_24h,
        COUNT(*) FILTER (WHERE status IN ('confirmed', 'processing') AND COALESCE(confirmed_at, created_at) < NOW() - INTERVAL '48 hours') AS unshipped_over_48h,
        COUNT(*) FILTER (WHERE shipment_status = 'delivery_attempted') AS delivery_attempted,
        COUNT(*) FILTER (WHERE status = 'cancel_requested') AS cancel_requested,
        COUNT(*) FILTER (WHERE payment_status <> 'paid' AND COALESCE(payment_mode, '') NOT ILIKE '%cod%' AND COALESCE(source, 'online') = 'online' AND status NOT IN ('cancelled', 'returned')) AS unpaid_online,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status <> 'paid' AND COALESCE(payment_mode, '') NOT ILIKE '%cod%' AND COALESCE(source, 'online') = 'online' AND status NOT IN ('cancelled', 'returned')), 0) AS unpaid_online_amt
      FROM orders
    `),
    queryOne<Record<string, string>>(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${startExpr}) AS in_range,
        COUNT(*) FILTER (WHERE resolved_at IS NULL AND status NOT IN ('rejected', 'completed', 'cancelled')) AS open_all
      FROM return_requests
    `),
    queryOne<Record<string, string>>(`
      SELECT
        COALESCE(SUM(COALESCE(discount_amount, 0) + COALESCE(business_discount_amount, 0)) FILTER (WHERE payment_status = 'paid'), 0) AS discount_total,
        COUNT(*) FILTER (WHERE payment_status = 'paid' AND (COALESCE(discount_amount, 0) > 0 OR COALESCE(business_discount_amount, 0) > 0)) AS discounted_orders,
        COALESCE(SUM(shipping_amount) FILTER (WHERE payment_status = 'paid'), 0) AS shipping_charged,
        COALESCE(SUM(COALESCE(delhivery_billed_amount, COALESCE(delhivery_freight_charge, 0) + COALESCE(delhivery_cod_charge, 0) + COALESCE(delhivery_oda_charge, 0))) FILTER (WHERE awb_number IS NOT NULL), 0) AS shipping_cost,
        COUNT(*) FILTER (WHERE awb_number IS NOT NULL) AS shipped_via_delhivery,
        COALESCE(SUM(COALESCE(cgst_amount, 0) + COALESCE(sgst_amount, 0) + COALESCE(igst_amount, 0)) FILTER (WHERE payment_status = 'paid'), 0) AS gst_collected,
        COALESCE(SUM(cod_fee_amount) FILTER (WHERE payment_status = 'paid'), 0) AS cod_fees,
        (SELECT COUNT(*) FROM coupon_usage WHERE created_at >= ${startExpr}) AS coupon_uses,
        (SELECT COALESCE(SUM(discount_amount), 0) FROM coupon_usage WHERE created_at >= ${startExpr}) AS coupon_discount
      FROM orders WHERE created_at >= ${startExpr} AND status <> 'cancelled'
    `),
    queryMany<Record<string, string>>(`
      SELECT c.code, COUNT(*) AS uses, COALESCE(SUM(cu.discount_amount), 0) AS discount
        FROM coupon_usage cu JOIN coupons c ON c.id = cu.coupon_id
       WHERE cu.created_at >= ${startExpr}
       GROUP BY c.code ORDER BY uses DESC, discount DESC LIMIT 4
    `),
    queryOne<Record<string, string>>(`
      WITH carts AS (
        SELECT user_id, SUM(quantity * price_at_addition) AS value, MAX(updated_at) AS last_upd
          FROM cart_items WHERE saved_for_later = false GROUP BY user_id
      ), abandoned AS (
        SELECT * FROM carts c
         WHERE c.last_upd < NOW() - INTERVAL '1 day' AND c.last_upd >= ${startExpr}
           AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = c.user_id AND o.created_at >= c.last_upd)
      )
      SELECT
        (SELECT COUNT(*) FROM carts) AS active_carts,
        (SELECT COALESCE(SUM(value), 0) FROM carts) AS cart_value,
        (SELECT COUNT(*) FROM abandoned) AS abandoned_carts,
        (SELECT COALESCE(SUM(value), 0) FROM abandoned) AS abandoned_value,
        (SELECT COUNT(*) FROM cart_items WHERE saved_for_later = true) AS saved_for_later
    `),
    queryOne<Record<string, string>>(`
      SELECT
        (SELECT COUNT(*) FROM wishlist_items WHERE created_at >= ${startExpr}) AS wishlist_adds,
        (SELECT COUNT(*) FROM back_in_stock_notify WHERE notified = false) AS back_in_stock,
        (SELECT COUNT(*) FROM product_reviews WHERE created_at >= ${startExpr}) AS new_reviews,
        (SELECT AVG(rating) FROM product_reviews WHERE created_at >= ${startExpr}) AS avg_rating,
        (SELECT AVG(rating) FROM product_reviews WHERE is_approved = true) AS avg_rating_all,
        (SELECT COUNT(*) FROM product_reviews WHERE is_approved = false) AS pending_reviews,
        (SELECT COUNT(*) FROM product_reviews WHERE created_at >= ${startExpr} AND rating <= 2) AS low_rating,
        (SELECT COUNT(*) FROM search_logs WHERE created_at >= ${startExpr}) AS searches,
        (SELECT COUNT(*) FROM search_logs WHERE created_at >= ${startExpr} AND results_count = 0) AS zero_searches,
        (SELECT COUNT(*) FROM support_sessions WHERE status = 'open') AS support_open,
        (SELECT COUNT(*) FROM support_sessions WHERE created_at >= ${startExpr}) AS support_in_range,
        (SELECT AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600) FROM support_sessions WHERE closed_at IS NOT NULL AND created_at >= ${startExpr}) AS support_hours,
        (SELECT COUNT(*) FROM customer_tasks WHERE status IN ('pending', 'in_progress') AND due_date < CURRENT_DATE) AS overdue_tasks,
        (SELECT COUNT(*) FROM customer_tasks WHERE status IN ('pending', 'in_progress')) AS open_tasks,
        (SELECT COUNT(*) FROM business_rfqs WHERE status = 'pending') AS pending_rfqs,
        (SELECT COUNT(*) FROM users WHERE created_at >= ${startExpr} AND COALESCE(is_guest, false) = false) AS signups,
        (SELECT COUNT(*) FROM users WHERE ${prevWindow} AND COALESCE(is_guest, false) = false) AS signups_prev
    `),
    queryMany<Record<string, string>>(`
      SELECT LOWER(TRIM(query)) AS q, COUNT(*) AS n
        FROM search_logs
       WHERE created_at >= ${startExpr} AND results_count = 0 AND query IS NOT NULL AND TRIM(query) <> ''
       GROUP BY 1 ORDER BY n DESC LIMIT 5
    `),
    queryOne<Record<string, string>>(`
      SELECT COUNT(*) FILTER (WHERE churn_risk = 'healthy') AS healthy,
             COUNT(*) FILTER (WHERE churn_risk = 'rising_concern') AS rising,
             COUNT(*) FILTER (WHERE churn_risk = 'high') AS high,
             AVG(score) AS avg_score
        FROM customer_health
    `),
    queryOne<Record<string, string>>(`
      WITH sold AS (
        SELECT oi.product_id, SUM(oi.quantity) AS units
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.created_at >= ${startExpr} AND o.status <> 'cancelled'
         GROUP BY oi.product_id
      ), stock AS (
        SELECT p.id,
               CASE WHEN p.has_variants THEN (SELECT COALESCE(SUM(COALESCE(pv.inventory_quantity, 0)), 0) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true)
                    ELSE COALESCE(p.inventory_quantity, 0) END AS qty,
               CASE WHEN p.has_variants THEN (SELECT COALESCE(SUM(COALESCE(pv.inventory_quantity, 0) * COALESCE(NULLIF(pv.cost_price, 0), NULLIF(pv.price, 0), NULLIF(p.cost_price, 0), NULLIF(p.base_price, 0), 0)), 0) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true)
                    ELSE COALESCE(p.inventory_quantity, 0) * COALESCE(NULLIF(p.cost_price, 0), NULLIF(p.base_price, 0), 0) END AS value
          FROM products p
         WHERE p.is_active = true AND COALESCE(p.is_draft, false) = false
      )
      SELECT
        (SELECT COUNT(*) FROM products WHERE is_active = true AND COALESCE(is_draft, false) = false) AS active_products,
        (SELECT COUNT(*) FROM products WHERE COALESCE(is_draft, false) = true) AS draft_products,
        (SELECT COUNT(*) FROM products WHERE created_at >= ${startExpr} AND COALESCE(is_draft, false) = false) AS new_products,
        COUNT(*) FILTER (WHERE s.units IS NULL AND st.qty > 0) AS slow_movers,
        COALESCE(SUM(st.value) FILTER (WHERE s.units IS NULL AND st.qty > 0), 0) AS slow_mover_value,
        COUNT(*) FILTER (WHERE s.units > 0) AS products_sold,
        COUNT(*) FILTER (WHERE s.units > 0 AND st.qty > 0 AND st.qty / (s.units / ${days}.0) < 7) AS restock_soon,
        COUNT(*) FILTER (WHERE s.units > 0 AND st.qty <= 0) AS selling_but_out,
        (SELECT COUNT(*) FROM product_batches WHERE quantity_remaining > 0 AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS expiring_batches,
        (SELECT COALESCE(SUM(quantity_remaining), 0) FROM product_batches WHERE quantity_remaining > 0 AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS expiring_qty,
        (SELECT COUNT(*) FROM product_batches WHERE quantity_remaining > 0 AND expiry_date < CURRENT_DATE) AS expired_batches
      FROM stock st LEFT JOIN sold s ON s.product_id = st.id
    `),
    queryMany<Record<string, string>>(`
      WITH v AS (
        SELECT product_id, COUNT(*) AS views FROM product_views
         WHERE created_at >= ${startExpr} GROUP BY product_id ORDER BY views DESC LIMIT 6
      ), s AS (
        SELECT oi.product_id, SUM(oi.quantity) AS units, SUM(oi.total_price) AS revenue
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.created_at >= ${startExpr} AND o.status <> 'cancelled'
         GROUP BY oi.product_id
      )
      SELECT p.id::text AS id, p.name, v.views, COALESCE(s.units, 0) AS units, COALESCE(s.revenue, 0) AS revenue
        FROM v JOIN products p ON p.id = v.product_id LEFT JOIN s ON s.product_id = v.product_id
       ORDER BY v.views DESC
    `),
    queryMany<Record<string, string>>(`
      SELECT p.id::text AS id, p.name,
             SUM(oi.total_price) AS revenue,
             SUM(oi.quantity) AS units,
             SUM(oi.quantity * COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0), 0)) AS cogs,
             COALESCE(SUM(oi.quantity) FILTER (WHERE COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0), 0) > 0), 0) AS costed_units
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
       WHERE o.created_at >= ${startExpr} AND o.payment_status = 'paid'
       GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT 6
    `),
    queryMany<Record<string, string>>(`
      SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS h, COUNT(*) AS n
        FROM orders WHERE created_at >= ${startExpr} GROUP BY 1
    `),
    queryMany<Record<string, string>>(`
      SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS h, COUNT(*) AS n
        FROM page_events WHERE created_at >= ${startExpr} GROUP BY 1
    `),
    queryMany<Record<string, string>>(`
      SELECT COALESCE(NULLIF(source, ''), 'online') AS source, COUNT(*) AS n,
             COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) AS revenue
        FROM orders WHERE created_at >= ${startExpr} GROUP BY 1 ORDER BY n DESC
    `),
    queryMany<Record<string, string>>(`
      SELECT TRIM(shipping_address_snapshot->>'state') AS state, COUNT(*) AS n,
             COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) AS revenue
        FROM orders
       WHERE created_at >= ${startExpr} AND NULLIF(TRIM(shipping_address_snapshot->>'state'), '') IS NOT NULL
       GROUP BY 1 ORDER BY n DESC LIMIT 5
    `),
    queryOne<Record<string, string>>(`
      SELECT
        (SELECT COUNT(*) FROM cash_sales WHERE created_at >= ${startExpr} AND COALESCE(status, '') <> 'cancelled') AS cash_sales,
        (SELECT COALESCE(SUM(total_amount), 0) FROM cash_sales WHERE created_at >= ${startExpr} AND COALESCE(status, '') <> 'cancelled') AS cash_sales_value,
        (SELECT COALESCE(SUM(total_amount), 0) FROM expenses WHERE expense_date >= (${startExpr})::date AND COALESCE(status, '') <> 'cancelled') AS expenses,
        (SELECT COUNT(*) FROM expenses WHERE due_date < CURRENT_DATE AND COALESCE(status, '') NOT IN ('paid', 'cancelled')) AS overdue_bills,
        (SELECT COALESCE(SUM(total_amount), 0) FROM expenses WHERE due_date < CURRENT_DATE AND COALESCE(status, '') NOT IN ('paid', 'cancelled')) AS overdue_bills_amt,
        (SELECT COUNT(*) FROM quotations WHERE converted_order_id IS NULL AND COALESCE(status, '') NOT IN ('rejected', 'expired', 'cancelled', 'converted')) AS open_quotes,
        (SELECT COALESCE(SUM(total_amount), 0) FROM quotations WHERE converted_order_id IS NULL AND COALESCE(status, '') NOT IN ('rejected', 'expired', 'cancelled', 'converted')) AS open_quotes_value,
        (SELECT COUNT(*) FROM purchase_orders WHERE COALESCE(status, '') NOT IN ('received', 'cancelled', 'closed', 'completed')) AS open_pos,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders WHERE COALESCE(status, '') NOT IN ('received', 'cancelled', 'closed', 'completed')) AS open_pos_value
    `),
  ])

  const { revenue, revenuePrev } = await paid
  const cogs = num(money?.cogs),
    cogsPrev = num(money?.cogs_prev)
  const gross = revenue - cogs,
    grossPrev = revenuePrev - cogsPrev
  const paidUnits = num(money?.paid_units),
    costedUnits = num(money?.costed_units)
  const units = num(money?.units),
    unitsPrev = num(money?.units_prev)

  const sessions = int(conv?.sessions),
    sessionsPrev = int(conv?.sessions_prev)
  const paidOrders = int(conv?.paid_orders),
    paidOrdersPrev = int(conv?.paid_orders_prev)
  const rate = ratio(int(conv?.online_paid), sessions, 2),
    ratePrev = ratio(int(conv?.online_paid_prev), sessionsPrev, 2)

  const ordersCur = int(ful?.orders_cur),
    ordersPrev = int(ful?.orders_prev),
    deliveredCur = int(ful?.delivered_cur)
  const returnsInRange = int(ret?.in_range)
  const discountTotal = num(promo?.discount_total)

  const byHour = Array.from({ length: 24 }, () => 0)
  for (const r of hours) {
    const h = int(r.h)
    if (h >= 0 && h < 24) byHour[h] = int(r.n)
  }
  const trafficByHour = Array.from({ length: 24 }, () => 0)
  for (const r of traffic) {
    const h = int(r.h)
    if (h >= 0 && h < 24) trafficByHour[h] = int(r.n)
  }

  return {
    money: {
      cogs,
      gross,
      grossPrev,
      grossPct: pctDelta(gross, grossPrev),
      marginPct: revenue > 0 ? round1((gross / revenue) * 100) : null,
      marginPctPrev: revenuePrev > 0 ? round1((grossPrev / revenuePrev) * 100) : null,
      costCoveragePct: ratio(costedUnits, paidUnits, 0),
      units,
      unitsPrev,
      unitsPct: pctDelta(units, unitsPrev),
    },
    conversion: {
      sessions,
      sessionsPrev,
      productViews: int(conv?.product_views),
      productViewsPrev: int(conv?.product_views_prev),
      paidOrders,
      paidOrdersPrev,
      rate,
      ratePrev,
      ratePct: rate != null && ratePrev != null ? pctDelta(rate, ratePrev) : null,
    },
    fulfilment: {
      avgHoursToShip: round2(nullable(ful?.ship_hours)),
      avgHoursToShipPrev: round2(nullable(ful?.ship_hours_prev)),
      avgDaysToDeliver: round2(nullable(ful?.deliver_days)),
      onTimePct: ratio(int(ful?.eta_on_time), int(ful?.eta_total), 0),
      etaSample: int(ful?.eta_total),
      cancelRate: ratio(int(ful?.cancelled_cur), ordersCur),
      cancelRatePrev: ratio(int(ful?.cancelled_prev), ordersPrev),
      returnRate: ratio(returnsInRange, deliveredCur > 0 ? deliveredCur : ordersCur),
      returnsInRange,
      guestShare: ratio(int(ful?.guest_cur), ordersCur, 0),
    },
    attention: {
      pendingOver24h: int(ful?.pending_over_24h),
      unshippedOver48h: int(ful?.unshipped_over_48h),
      deliveryAttempted: int(ful?.delivery_attempted),
      cancelRequested: int(ful?.cancel_requested),
      unpaidOnline: int(ful?.unpaid_online),
      unpaidOnlineAmount: num(ful?.unpaid_online_amt),
      openReturns: int(ret?.open_all),
      pendingReviews: int(eng?.pending_reviews),
      backInStockWaitlist: int(eng?.back_in_stock),
      supportOpen: int(eng?.support_open),
      overdueTasks: int(eng?.overdue_tasks),
      openTasks: int(eng?.open_tasks),
      pendingRfqs: int(eng?.pending_rfqs),
      churnHigh: int(health?.high),
      expiringBatches: int(cat?.expiring_batches),
      expiredBatches: int(cat?.expired_batches),
      sellingButOut: int(cat?.selling_but_out),
      restockSoon: int(cat?.restock_soon),
      overdueBills: int(cash?.overdue_bills),
    },
    promotions: {
      discountTotal,
      discountPctOfRevenue: ratio(discountTotal, revenue + discountTotal),
      discountedOrders: int(promo?.discounted_orders),
      couponUses: int(promo?.coupon_uses),
      couponDiscount: num(promo?.coupon_discount),
      topCoupons: coupons.map(c => ({ code: c.code, uses: int(c.uses), discount: num(c.discount) })),
    },
    carts: {
      activeCarts: int(cart?.active_carts),
      cartValue: num(cart?.cart_value),
      abandonedCarts: int(cart?.abandoned_carts),
      abandonedValue: num(cart?.abandoned_value),
      savedForLater: int(cart?.saved_for_later),
    },
    engagement: {
      wishlistAdds: int(eng?.wishlist_adds),
      newReviews: int(eng?.new_reviews),
      avgRating: round1(nullable(eng?.avg_rating)),
      avgRatingAll: round1(nullable(eng?.avg_rating_all)),
      lowRatingReviews: int(eng?.low_rating),
      searches: int(eng?.searches),
      zeroResultSearches: int(eng?.zero_searches),
      topZeroSearches: zero.map(z => ({ query: z.q, count: int(z.n) })),
      supportInRange: int(eng?.support_in_range),
      supportResolutionHours: round2(nullable(eng?.support_hours)),
      signups: int(eng?.signups),
      signupsPrev: int(eng?.signups_prev),
      signupsPct: pctDelta(int(eng?.signups), int(eng?.signups_prev)),
    },
    health: {
      healthy: int(health?.healthy),
      rising: int(health?.rising),
      high: int(health?.high),
      avgScore: round1(nullable(health?.avg_score)),
    },
    catalog: {
      activeProducts: int(cat?.active_products),
      draftProducts: int(cat?.draft_products),
      newProducts: int(cat?.new_products),
      productsSold: int(cat?.products_sold),
      slowMovers: int(cat?.slow_movers),
      slowMoverValue: num(cat?.slow_mover_value),
      expiringQty: num(cat?.expiring_qty),
    },
    topViewed: viewed.map(v => {
      const views = int(v.views),
        unitsSold = num(v.units)
      return {
        id: v.id,
        name: v.name,
        views,
        units: unitsSold,
        revenue: num(v.revenue),
        conversion: ratio(unitsSold, views),
      }
    }),
    marginByProduct: margins.map(m => {
      const rev = num(m.revenue),
        c = num(m.cogs),
        u = num(m.units),
        costed = num(m.costed_units)
      return {
        id: m.id,
        name: m.name,
        revenue: rev,
        units: u,
        marginPct: rev > 0 && costed > 0 && costed >= u * 0.5 ? round1(((rev - c) / rev) * 100) : null,
      }
    }),
    cash: {
      gstCollected: num(promo?.gst_collected),
      shippingCharged: num(promo?.shipping_charged),
      shippingCost: num(promo?.shipping_cost),
      shippedViaDelhivery: int(promo?.shipped_via_delhivery),
      codFees: num(promo?.cod_fees),
      cashSales: int(cash?.cash_sales),
      cashSalesValue: num(cash?.cash_sales_value),
      expenses: num(cash?.expenses),
      overdueBillsAmount: num(cash?.overdue_bills_amt),
      openQuotes: int(cash?.open_quotes),
      openQuotesValue: num(cash?.open_quotes_value),
      openPos: int(cash?.open_pos),
      openPosValue: num(cash?.open_pos_value),
    },
    byHour,
    trafficByHour,
    bySource: sources.map(s => ({ source: s.source, orders: int(s.n), revenue: num(s.revenue) })),
    topStates: states.map(s => ({ state: s.state, orders: int(s.n), revenue: num(s.revenue) })),
  }
}
