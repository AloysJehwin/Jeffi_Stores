import { queryOne, queryMany, queryCount } from './shared'
import { buildSearchClause } from '../search'

const CUSTOMER_SORT_COLS: Record<string, string> = {
  name: "u.first_name || ' ' || u.last_name",
  email: 'u.email',
  phone: 'u.phone',
  joined: 'u.created_at',
  orders: 'o.order_count',
  lifetime_value: 'o.lifetime_value',
}

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
}) {
  const CUSTOMER_SORT_COLS: Record<string, string> = {
    name: "u.first_name || ' ' || u.last_name",
    email: 'u.email',
    phone: 'u.phone',
    joined: 'u.created_at',
    orders: 'o.order_count',
    lifetime_value: 'o.lifetime_value',
    status: 'u.is_active',
    health: 'COALESCE(ch.score, -1)',
  }

  const conditions: string[] = ['u.is_guest = false']
  const params: any[] = []
  let i = 1

  if (filters.status === 'active') {
    conditions.push(`u.is_active = true AND u.is_flagged = false`)
  } else if (filters.status === 'inactive') {
    conditions.push(`u.is_active = false AND u.is_flagged = false`)
  } else if (filters.status === 'flagged') {
    conditions.push(`u.is_flagged = true`)
  }

  if (filters.search) {
    const sc = buildSearchClause(filters.search, ['u.email', 'u.first_name', 'u.last_name', 'u.phone'], i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  if (filters.tag) {
    conditions.push(`EXISTS (SELECT 1 FROM customer_tags ct WHERE ct.user_id = u.id AND ct.tag = $${i})`)
    params.push(filters.tag.toLowerCase())
    i++
  }

  if (filters.segment) {
    const seg = filters.segment
    if (seg === 'b2b') {
      conditions.push(`(cp.gst_number IS NOT NULL OR cp.company_name IS NOT NULL)`)
    } else if (seg === 'vip') {
      conditions.push(`COALESCE(o.lifetime_value, 0) >= 50000`)
    } else if (seg === 'loyal') {
      conditions.push(`COALESCE(o.paid_orders, 0) >= 5 AND COALESCE(o.lifetime_value, 0) >= 25000`)
    } else if (seg === 'repeat') {
      conditions.push(`COALESCE(o.order_count, 0) >= 3`)
    } else if (seg === 'one_time') {
      conditions.push(`COALESCE(o.order_count, 0) = 1`)
    } else if (seg === 'new') {
      conditions.push(`u.created_at >= NOW() - INTERVAL '30 days'`)
    } else if (seg === 'at_risk') {
      conditions.push(
        `o.last_order_at IS NOT NULL AND o.last_order_at < NOW() - INTERVAL '90 days' AND o.last_order_at >= NOW() - INTERVAL '180 days'`
      )
    } else if (seg === 'dormant') {
      conditions.push(`o.last_order_at IS NOT NULL AND o.last_order_at < NOW() - INTERVAL '180 days'`)
    } else if (seg === 'lead') {
      conditions.push(`COALESCE(o.order_count, 0) = 0`)
    }
  }

  if (filters.health === 'healthy') {
    conditions.push(`ch.score >= 70`)
  } else if (filters.health === 'at_risk') {
    conditions.push(`ch.score >= 40 AND ch.score < 70`)
  } else if (filters.health === 'critical') {
    conditions.push(`ch.score IS NOT NULL AND ch.score < 40`)
  } else if (filters.health === 'unknown') {
    conditions.push(`ch.score IS NULL`)
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const limit = filters.limit || 50
  const offset = ((filters.page || 1) - 1) * limit
  const sortCol = CUSTOMER_SORT_COLS[filters.sort || ''] || 'u.created_at'
  const sortDir = filters.dir === 'asc' ? 'ASC' : 'DESC'

  const safeCol = filters.sort && CUSTOMER_SORT_COLS[filters.sort] ? CUSTOMER_SORT_COLS[filters.sort] : 'u.created_at'
  const safeDir = filters.dir === 'asc' ? 'ASC' : 'DESC'

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
      ${where}
      ORDER BY ${safeCol} ${safeDir}
      LIMIT $${i} OFFSET $${i + 1}
    `,
      [...params, limit, offset]
    ),
    queryCount(
      `
      SELECT COUNT(*) FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
      LEFT JOIN customer_health ch ON ch.user_id = u.id
      LEFT JOIN (
        SELECT user_id,
               COUNT(*) AS order_count,
               COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               MAX(created_at) AS last_order_at,
               SUM(total_amount) AS lifetime_value
        FROM orders GROUP BY user_id
      ) o ON u.id = o.user_id
      ${where}
    `,
      params
    ),
  ])

  return { customers, total }
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
