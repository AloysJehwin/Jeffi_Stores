import { buildWhere, normalizeQuery, type FilterCtx, type FilterQuery } from '@jeffi/list-filters'
import { queryOne, queryMany, queryCount } from './shared'
import { ORDERS_ENTITY, ORDER_SORTS } from '@/lib/filters/entities/orders'
import { FULFILLED_SQL } from '@/lib/orders/fulfilled-status'
import { orderItemFactorSql, orderItemUnitSql } from '@/lib/orders/unit-conversion'

export async function getAllOrders() {
  return queryMany(`
    SELECT
      o.*,
      json_build_object(
        'id', u.id, 'email', u.email, 'first_name', u.first_name,
        'last_name', u.last_name, 'phone', u.phone
      ) AS users
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC
  `)
}

const ORDER_LIST_SELECT = `
      SELECT
        o.*,
        json_build_object(
          'id', u.id, 'email', u.email, 'first_name', u.first_name,
          'last_name', u.last_name, 'phone', u.phone
        ) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id`

/** One page of orders for a normalised filter query, plus the matching total. */
export async function queryOrders(
  q: FilterQuery,
  opts: { page?: number; limit?: number; sort?: string; dir?: string; ctx?: FilterCtx } = {}
) {
  const ctx = opts.ctx ?? (await ORDERS_ENTITY.context?.(q)) ?? {}
  const w = buildWhere(ORDERS_ENTITY, q, 1, { ctx })
  const limit = opts.limit || 25
  const offset = ((opts.page || 1) - 1) * limit
  const sortCol = ORDER_SORTS[opts.sort || ''] || 'o.created_at'
  const sortDir = opts.dir === 'asc' ? 'ASC' : 'DESC'

  const [orders, countResult] = await Promise.all([
    queryMany(
      `${ORDER_LIST_SELECT}
      ${w.where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}
    `,
      [...w.params, limit, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM orders o ${w.where}`, w.params),
  ])

  return { orders, total: countResult }
}

/** Raw URL-style filters (old names accepted) → queryOrders. */
export async function getFilteredOrders(filters: {
  status?: string
  payment_status?: string
  source?: string
  search?: string
  date_from?: string
  date_to?: string
  amount_min?: string
  amount_max?: string
  awb?: string
  shipment_status?: string
  payment_mode?: string
  coupon_code?: string
  cod_pending?: string
  page?: number
  limit?: number
  sort?: string
  dir?: string
  [param: string]: string | number | undefined
}) {
  const { page, limit, sort, dir, ...rest } = filters
  return queryOrders(normalizeQuery(ORDERS_ENTITY, rest), {
    page: typeof page === 'number' ? page : undefined,
    limit: typeof limit === 'number' ? limit : undefined,
    sort: typeof sort === 'string' ? sort : undefined,
    dir: typeof dir === 'string' ? dir : undefined,
  })
}

export interface OrdersSummary {
  total: number
  pending: number
  processing: number
  completed: number
  paidRevenue: number
}

/** The list's KPI strip over every matching order (not just the page shown). */
export async function getOrdersSummary(q: FilterQuery, ctx?: FilterCtx): Promise<OrdersSummary> {
  const w = buildWhere(ORDERS_ENTITY, q, 1, { ctx: ctx ?? (await ORDERS_ENTITY.context?.(q)) ?? {} })
  const r = await queryOne<Record<string, string | number | null>>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE o.status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE o.status = 'processing') AS processing,
            COUNT(*) FILTER (WHERE ${FULFILLED_SQL}) AS completed,
            COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS paid_revenue
     FROM orders o ${w.where}`,
    w.params
  )
  const n = (v: unknown) => Number(v ?? 0) || 0
  return {
    total: n(r?.total),
    pending: n(r?.pending),
    processing: n(r?.processing),
    completed: n(r?.completed),
    paidRevenue: n(r?.paid_revenue),
  }
}

export async function getRecentOrders(limit: number = 10) {
  return queryMany('SELECT * FROM orders ORDER BY created_at DESC LIMIT $1', [limit])
}

export async function getOrder(id: string) {
  const order = await queryOne(
    `
    SELECT
      o.*,
      json_build_object(
        'id', u.id, 'email', u.email, 'first_name', u.first_name,
        'last_name', u.last_name, 'phone', u.phone
      ) AS users,
      COALESCE(
        (SELECT json_agg(
          json_build_object(
            'id', oi.id, 'order_id', oi.order_id, 'product_id', oi.product_id,
            'product_name', oi.product_name, 'product_sku', oi.product_sku,
            'variant_name', oi.variant_name, 'quantity', oi.quantity,
            'unit_price', oi.unit_price, 'discount_amount', oi.discount_amount,
            'tax_amount', oi.tax_amount, 'total_price', oi.total_price,
            'buy_mode', oi.buy_mode, 'buy_unit', oi.buy_unit,
            'created_at', oi.created_at,
            'variant_id', oi.variant_id,
            'sub_variant_id', oi.sub_variant_id,
            'sell_unit', ${orderItemUnitSql()},
            'sell_unit_factor', COALESCE(${orderItemFactorSql()}, (SELECT pu.factor FROM product_units pu WHERE pu.unit = oi.buy_unit AND pu.product_id = oi.product_id LIMIT 1)),
            'sell_unit_dimension', (SELECT pu.dimension FROM product_units pu WHERE pu.unit = oi.buy_unit AND pu.product_id = oi.product_id LIMIT 1),
            'products', json_build_object(
              'id', pr.id, 'name', pr.name, 'sku', pr.sku,
              'slug', pr.slug,
              'inventory_quantity', pr.inventory_quantity,
              'extra_delivery_days', pr.extra_delivery_days,
              'image_url', (SELECT COALESCE(pi2.thumbnail_url, pi2.image_url) FROM product_images pi2 WHERE pi2.product_id = pr.id AND pi2.is_primary = true LIMIT 1)
            ),
            'variant', CASE WHEN oi.variant_id IS NOT NULL THEN
              json_build_object(
                'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
                'inventory_quantity', CASE
                  WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
                  THEN COALESCE((SELECT SUM(sv2.inventory_quantity) FROM product_sub_variants sv2 WHERE sv2.variant_id = pv.id AND sv2.is_active = true), 0)
                  ELSE pv.inventory_quantity
                END
              )
            ELSE NULL END,
            'sub_variant', CASE WHEN oi.sub_variant_id IS NOT NULL THEN
              json_build_object(
                'id', psv.id, 'sub_variant_name', psv.sub_variant_name, 'sku', psv.sku,
                'inventory_quantity', psv.inventory_quantity
              )
            ELSE NULL END
          )
        )
        FROM order_items oi
        LEFT JOIN products pr ON oi.product_id = pr.id
        LEFT JOIN product_variants pv ON oi.variant_id = pv.id
        LEFT JOIN product_sub_variants psv ON oi.sub_variant_id = psv.id
        WHERE oi.order_id = o.id),
        '[]'::json
      ) AS order_items,
      COALESCE(
        (SELECT row_to_json(sa) FROM addresses sa WHERE sa.id = o.shipping_address_id),
        o.shipping_address_snapshot::json
      ) AS shipping_address,
      COALESCE(
        (SELECT row_to_json(ba) FROM addresses ba WHERE ba.id = o.billing_address_id),
        o.billing_address_snapshot::json
      ) AS billing_address,
      COALESCE(
        (SELECT json_agg(pay) FROM payments pay WHERE pay.order_id = o.id),
        '[]'::json
      ) AS payments,
      orig.order_number AS original_order_number
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN orders orig ON orig.id = o.original_order_id
    WHERE o.id = $1
  `,
    [id]
  )

  if (!order) throw new Error('Order not found')
  return order
}

export async function getReturnRequest(orderId: string) {
  const returnRequest = await queryOne(
    `
    SELECT rr.*, o2.order_number AS replacement_order_number,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', rri.id,
          'order_item_id', rri.order_item_id,
          'product_id', rri.product_id,
          'variant_id', rri.variant_id,
          'quantity', rri.quantity,
          'unit_price', rri.unit_price,
          'refund_amount', rri.refund_amount,
          'product_name', rri.product_name,
          'variant_name', rri.variant_name
        ) ORDER BY rri.created_at)
        FROM return_request_items rri WHERE rri.return_request_id = rr.id),
        '[]'::json
      ) AS items
    FROM return_requests rr
    LEFT JOIN orders o2 ON o2.id = rr.replacement_order_id
    WHERE rr.order_id = $1
    ORDER BY rr.created_at DESC
    LIMIT 1
  `,
    [orderId]
  )
  return returnRequest || null
}

// ── Dashboard analytics (range-aware) ────────────────────────────────────────
