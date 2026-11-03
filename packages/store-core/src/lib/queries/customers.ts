import { buildWhere, normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { queryOne, queryMany, queryCount, entityOrderBy } from './shared'
import type { CustomerStats } from './analytics'
import { CUSTOMERS_ENTITY } from '@/lib/filters/entities/customers'

/** One page of customers for a normalised filter query, plus the matching total. */
export async function queryCustomers(
  q: FilterQuery,
  opts: { page?: number; limit?: number; sort?: string; dir?: string } = {}
) {
  const w = buildWhere(CUSTOMERS_ENTITY, q, 1)
  const i = w.nextIdx
  const limit = opts.limit || 50
  const offset = ((opts.page || 1) - 1) * limit

  const [customers, total] = await Promise.all([
    queryMany(
      `
      SELECT
        u.id, u.email, u.phone, u.first_name, u.last_name,
        u.is_active, u.is_flagged, u.flag_reason, u.created_at,
        u.user_type,
        cp.customer_type,
        COALESCE(o.order_count, 0) AS order_count,
        COALESCE(o.lifetime_value, 0) AS lifetime_value,
        o.last_order_at,
        ch.score AS health_score,
        ch.churn_risk,
        ch.trend_delta_30d,
        COALESCE(
          (SELECT array_agg(ct.tag ORDER BY ct.created_at DESC) FROM customer_tags ct WHERE ct.user_id = u.id),
          ARRAY[]::varchar[]
        ) AS tags,
        bp.company_name AS bp_company_name,
        bp.approval_status AS bp_approval_status,
        bp.gst_number AS bp_gst_number,
        bp.industry AS bp_industry
      FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
      LEFT JOIN customer_health ch ON ch.user_id = u.id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      LEFT JOIN (
        SELECT user_id,
               COUNT(*) AS order_count,
               COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               MAX(created_at) AS last_order_at,
               SUM(total_amount) AS lifetime_value
        FROM orders GROUP BY user_id
      ) o ON u.id = o.user_id
      ${w.where}
      ${entityOrderBy(CUSTOMERS_ENTITY, opts.sort, opts.dir)}
      LIMIT $${i} OFFSET $${i + 1}
    `,
      [...w.params, limit, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM users u ${w.where}`, w.params),
  ])

  return { customers, total }
}

/** Raw URL-style filters → queryCustomers (tags are stored lower-case). */
export async function getCustomers(filters: {
  search?: string
  status?: string
  segment?: string
  tag?: string
  health?: string
  page?: number
  limit?: number
  sort?: string
  dir?: string
  [param: string]: string | number | undefined
}) {
  const { page, limit, sort, dir, ...rest } = filters
  if (typeof rest.tag === 'string') rest.tag = rest.tag.toLowerCase()
  return queryCustomers(normalizeQuery(CUSTOMERS_ENTITY, rest), {
    page: typeof page === 'number' ? page : undefined,
    limit: typeof limit === 'number' ? limit : undefined,
    sort: typeof sort === 'string' ? sort : undefined,
    dir: typeof dir === 'string' ? dir : undefined,
  })
}

/** The list's KPI strip over every matching customer. */
export async function getCustomersSummary(q: FilterQuery): Promise<CustomerStats> {
  const w = buildWhere(CUSTOMERS_ENTITY, q, 1)
  const r = await queryOne<CustomerStats>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE u.is_active AND NOT u.is_flagged)::int AS active,
            COUNT(*) FILTER (WHERE NOT u.is_active AND NOT u.is_flagged)::int AS inactive,
            COUNT(*) FILTER (WHERE u.is_flagged)::int AS flagged
     FROM users u ${w.where}`,
    w.params
  )
  return r ?? { total: 0, active: 0, inactive: 0, flagged: 0 }
}

export async function getCustomerById(id: string) {
  const customer = await queryOne(
    `
    SELECT
      u.id, u.email, u.phone, u.first_name, u.last_name,
      u.is_active, u.is_flagged, u.flag_reason, u.created_at,
      u.user_type, u.notification_channel, u.marketing_opt_out,
      cp.customer_type, cp.company_name, cp.gst_number, cp.credit_limit,
      bp.company_name AS bp_company_name,
      bp.approval_status AS bp_approval_status,
      bp.gst_number AS bp_gst_number,
      bp.industry AS bp_industry,
      bp.business_address AS bp_business_address,
      bp.created_at AS bp_created_at,
      bp.approved_at AS bp_approved_at,
      bp.rejection_note AS bp_rejection_note
    FROM users u
    LEFT JOIN customer_profiles cp ON u.id = cp.user_id
    LEFT JOIN business_profiles bp ON bp.user_id = u.id
    WHERE u.id = $1 AND u.is_guest = false
  `,
    [id]
  )

  if (!customer) throw new Error('Customer not found')

  const recentOrders = await queryMany(
    `
    SELECT id, order_number, total_amount, status, payment_status, created_at
    FROM orders
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `,
    [id]
  )

  const stats = await queryOne<{
    total_orders: string
    lifetime_value: string
    last_order_at: string | null
    paid_orders: string
  }>(
    `
    SELECT
      COUNT(*) AS total_orders,
      COALESCE(SUM(total_amount), 0) AS lifetime_value,
      MAX(created_at) AS last_order_at,
      COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders
    FROM orders
    WHERE user_id = $1
  `,
    [id]
  )

  const tags = await queryMany<{ id: string; tag: string; created_at: string }>(
    `
    SELECT id, tag, created_at FROM customer_tags WHERE user_id = $1 ORDER BY created_at DESC
  `,
    [id]
  )

  const notes = await queryMany<{
    id: string
    body: string
    created_at: string
    admin_username: string | null
    admin_first_name: string | null
    admin_last_name: string | null
  }>(
    `
    SELECT n.id, n.body, n.created_at,
           COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS admin_username, u.first_name AS admin_first_name, u.last_name AS admin_last_name
    FROM customer_notes n
    LEFT JOIN admins a ON n.admin_id = a.id
    LEFT JOIN users u ON a.user_id = u.id
    WHERE n.user_id = $1
    ORDER BY n.created_at DESC
    LIMIT 50
  `,
    [id]
  )

  const totalOrders = parseInt(stats?.total_orders ?? '0')
  const lifetimeValue = parseFloat(stats?.lifetime_value ?? '0')
  const paidOrders = parseInt(stats?.paid_orders ?? '0')
  const lastOrderAt = stats?.last_order_at ? new Date(stats.last_order_at) : null
  const createdAt = customer.created_at ? new Date(customer.created_at) : null
  const now = new Date()
  const daysSinceLastOrder = lastOrderAt ? Math.floor((now.getTime() - lastOrderAt.getTime()) / 86400000) : null
  const daysSinceJoined = createdAt ? Math.floor((now.getTime() - createdAt.getTime()) / 86400000) : null

  const segments: string[] = []
  if (customer.gst_number || customer.company_name) segments.push('b2b')
  if (lifetimeValue >= 50000) segments.push('vip')
  if (totalOrders >= 3) segments.push('repeat')
  if (totalOrders === 1) segments.push('one_time')
  if (daysSinceJoined !== null && daysSinceJoined <= 30) segments.push('new')
  if (daysSinceLastOrder !== null && daysSinceLastOrder >= 90 && daysSinceLastOrder < 180) segments.push('at_risk')
  if (daysSinceLastOrder !== null && daysSinceLastOrder >= 180) segments.push('dormant')
  if (totalOrders === 0) segments.push('lead')
  if (paidOrders >= 5 && lifetimeValue >= 25000) segments.push('loyal')

  const health = await queryOne<{
    score: number
    recency_score: number
    frequency_score: number
    monetary_score: number
    engagement_score: number
    satisfaction_score: number
    churn_risk: string
    trend_delta_7d: number
    trend_delta_30d: number
    last_computed_at: string
  }>(
    `
    SELECT score, recency_score, frequency_score, monetary_score, engagement_score, satisfaction_score,
           churn_risk, trend_delta_7d, trend_delta_30d, last_computed_at::text AS last_computed_at
    FROM customer_health WHERE user_id = $1
  `,
    [id]
  )

  const assignedCoupons = await queryMany<{
    id: string
    code: string
    discount_type: string
    discount_value: number
    valid_until: string | null
    times_used: number
    description: string | null
  }>(
    `
    SELECT DISTINCT ON (c.id) c.id, c.code, c.discount_type, c.discount_value, c.valid_until, c.times_used, c.description
    FROM coupons c
    WHERE c.is_active = true
      AND (c.valid_until IS NULL OR c.valid_until > NOW())
      AND (
        c.generated_for_user_id = $1
        OR EXISTS (SELECT 1 FROM coupon_eligible_users ceu WHERE ceu.coupon_id = c.id AND ceu.user_id = $1)
      )
    ORDER BY c.id, c.created_at DESC
  `,
    [id]
  )

  return {
    ...customer,
    recent_orders: recentOrders,
    total_orders: totalOrders,
    lifetime_value: lifetimeValue,
    last_order_at: stats?.last_order_at ?? null,
    days_since_last_order: daysSinceLastOrder,
    paid_orders: paidOrders,
    tags,
    notes,
    segments,
    health,
    assigned_coupons: assignedCoupons,
  }
}
