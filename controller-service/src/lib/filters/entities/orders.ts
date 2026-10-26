import { buildVectorSearchClause, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { CANCEL_REASON_SQL, NEEDS_SHIP_SQL } from '@/lib/overviews/orders'
import { ORDER_ALIASES, ORDER_FIELDS } from '../fields/orders'

type OrderKey = FieldKeys<typeof ORDER_FIELDS>

const items = (cond: string) => `EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND ${cond})`
const itemProducts = 'order_items oi JOIN products p ON p.id = oi.product_id'
const shipTo = (key: string, col: string) =>
  `COALESCE(NULLIF(btrim(o.shipping_address_snapshot->>'${key}'), ''), (SELECT a.${col} FROM addresses a WHERE a.id = o.shipping_address_id))`
const returns = (cond = 'TRUE') => `EXISTS (SELECT 1 FROM return_requests rr WHERE rr.order_id = o.id AND ${cond})`
const GOOGLE_CLICK = '(o.gclid IS NOT NULL OR o.gbraid IS NOT NULL OR o.wbraid IS NOT NULL)'
const META_CLICK = "COALESCE(o.meta_click_ids ? 'fbc' OR o.meta_click_ids ? 'fbclid', false)"

const SQL: Record<OrderKey, FieldSql> = {
  status: { kind: 'enum', expr: 'o.status' },
  payment_status: { kind: 'enum', expr: 'o.payment_status' },
  source: { kind: 'enum', expr: 'o.source' },

  created: { kind: 'date', expr: 'o.created_at' },
  shipped: { kind: 'date', expr: 'o.shipped_at' },
  delivered: { kind: 'date', expr: 'o.delivered_at' },
  amount: { kind: 'range', expr: 'o.total_amount' },
  discount: { kind: 'range', expr: 'o.discount_amount' },
  units: { kind: 'range', expr: '(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id)' },

  payment_mode: { kind: 'enum', expr: 'o.payment_mode' },
  payment_type: {
    kind: 'enum',
    virtual: {
      cod: "o.payment_mode = 'cod'",
      prepaid: "o.payment_mode NOT IN ('cod', 'credit')",
      credit: "o.payment_mode = 'credit'",
    },
  },
  gateway: {
    kind: 'values',
    lateral: { from: 'payments pay', link: 'pay.order_id = o.id', expr: 'pay.payment_gateway' },
  },
  coupon: {
    kind: 'values',
    fold: 'upper',
    lateral: {
      from: 'coupon_usage cu JOIN coupons c ON c.id = cu.coupon_id',
      link: 'cu.order_id = o.id',
      expr: 'c.code',
    },
  },
  has_coupon: { kind: 'bool', expr: 'EXISTS (SELECT 1 FROM coupon_usage cu WHERE cu.order_id = o.id)' },
  // COD cash collected on delivery but not yet remitted by Delhivery to the seller.
  cod_pending: {
    kind: 'flag',
    expr: "o.payment_mode = 'cod' AND o.payment_status = 'cod_collected' AND o.cod_remitted_at IS NULL",
  },
  payment_link: { kind: 'enum', expr: 'o.payment_link_status' },
  unpaid_stale: {
    kind: 'flag',
    expr: `o.payment_status = 'unpaid' AND o.payment_mode NOT IN ('cod', 'credit')
      AND o.status NOT IN ('cancelled', 'draft') AND o.created_at < NOW() - interval '1 day'`,
  },

  shipment_status: { kind: 'enum', expr: 'o.shipment_status' },
  awb: { kind: 'text', expr: 'o.awb_number', match: 'prefix' },
  rto: { kind: 'flag', expr: "o.shipment_status LIKE 'rto%'" },
  courier: { kind: 'bool', expr: `(${NEEDS_SHIP_SQL})` },
  late_to_ship: {
    kind: 'flag',
    expr: (ctx, bind) => `o.status IN ('confirmed', 'processing') AND o.shipped_at IS NULL AND ${NEEDS_SHIP_SQL}
      AND COALESCE(o.confirmed_at, o.created_at) < NOW() - make_interval(days => ${bind(Number(ctx.handlingDays ?? 3))}::int)`,
  },
  overdue: {
    kind: 'flag',
    expr: "o.status IN ('shipped', 'out_for_delivery') AND o.estimated_delivery_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date",
  },
  edd: { kind: 'date', expr: 'o.estimated_delivery_date', dateOnly: true },
  state: { kind: 'values', expr: shipTo('state', 'state') },
  city: { kind: 'values', expr: shipTo('city', 'city') },
  pincode: { kind: 'values', expr: shipTo('postal_code', 'postal_code') },
  shipping_method: { kind: 'values', expr: 'o.shipping_method' },

  customer: { kind: 'text', expr: ['o.customer_name', 'o.customer_email', 'o.customer_phone'] },
  // Razorpay payment / order ids and refund ids, wherever a payment, an order edit or a variant change keeps them.
  txn: {
    kind: 'custom',
    build: (q, bind) => {
      const id = bind(String(q.txn).trim())
      const inRefunds = (col: string) => `COALESCE(${col}, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', ${id}::text))`
      return `(EXISTS (SELECT 1 FROM payments pm WHERE pm.order_id = o.id AND (pm.transaction_id = ${id}
          OR pm.gateway_response->>'razorpay_payment_id' = ${id} OR pm.gateway_response->>'razorpay_order_id' = ${id}
          OR pm.gateway_response->'refund'->>'id' = ${id} OR ${inRefunds("pm.gateway_response->'partial_refunds'")}))
        OR EXISTS (SELECT 1 FROM order_adjustments oa WHERE oa.order_id = o.id
          AND (oa.razorpay_payment_id = ${id} OR ${inRefunds('oa.refunds')}))
        OR EXISTS (SELECT 1 FROM variant_change_requests vc WHERE vc.order_id = o.id
          AND (vc.razorpay_payment_id = ${id} OR vc.refund_id = ${id})))`
    },
  },
  customer_type: {
    kind: 'enum',
    virtual: {
      guest: 'NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.is_guest IS NOT TRUE)',
      business: "EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.user_type = 'business')",
      registered:
        "EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.is_guest IS NOT TRUE AND u.user_type IS DISTINCT FROM 'business')",
    },
  },
  tag: { kind: 'values', lateral: { from: 'customer_tags ct', link: 'ct.user_id = o.user_id', expr: 'ct.tag' } },
  flagged: { kind: 'flag', expr: 'EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.is_flagged)' },
  first_order: {
    kind: 'bool',
    expr: `o.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.user_id = o.user_id
      AND o2.created_at < o.created_at AND o2.status NOT IN ('draft', 'cancelled'))`,
  },
  b2b: { kind: 'bool', expr: "COALESCE(btrim(o.buyer_gstin), '') <> ''" },

  product: { kind: 'values', lateral: { from: 'order_items oi', link: 'oi.order_id = o.id', expr: 'oi.product_name' } },
  sku: {
    kind: 'values',
    fold: 'upper',
    lateral: { from: 'order_items oi', link: 'oi.order_id = o.id', expr: 'oi.product_sku' },
  },
  brand: {
    kind: 'values',
    lateral: { from: `${itemProducts} JOIN brands b ON b.id = p.brand_id`, link: 'oi.order_id = o.id', expr: 'b.name' },
  },
  // A parent category matches its children's items too.
  category: {
    kind: 'values',
    lateral: {
      from: `${itemProducts} JOIN categories c ON c.id = p.category_id LEFT JOIN categories pc ON pc.id = c.parent_category_id`,
      link: 'oi.order_id = o.id',
      expr: ['c.name', 'pc.name'],
    },
  },
  hsn: {
    kind: 'values',
    fold: 'upper',
    lateral: { from: 'order_items oi', link: 'oi.order_id = o.id', expr: 'oi.hsn_code' },
  },
  gst_rate: {
    kind: 'enum',
    expr: 'oi.gst_rate',
    cast: 'numeric',
    exists: { from: 'order_items oi', link: 'oi.order_id = o.id' },
  },
  digital: {
    kind: 'enum',
    virtual: {
      any: items('oi.is_digital'),
      only: `${items('oi.is_digital')} AND NOT ${items('oi.is_digital IS NOT TRUE')}`,
      none: `NOT ${items('oi.is_digital')}`,
    },
  },

  invoiced: { kind: 'bool', expr: 'o.invoice_number IS NOT NULL' },
  invoice: { kind: 'date', expr: 'o.invoice_date' },
  irn_status: { kind: 'enum', expr: 'o.irn_status' },
  eway: { kind: 'bool', expr: 'o.eway_bill_no IS NOT NULL' },
  igst: { kind: 'bool', expr: 'COALESCE(o.is_igst, false)' },

  return_type: {
    kind: 'enum',
    virtual: { any: returns(), refund: returns("rr.type = 'refund'"), replacement: returns("rr.type = 'replacement'") },
  },
  return_status: {
    kind: 'enum',
    expr: 'rr.status',
    exists: { from: 'return_requests rr', link: 'rr.order_id = o.id' },
  },
  replacement_order: { kind: 'bool', expr: 'o.original_order_id IS NOT NULL' },
  subscription: { kind: 'bool', expr: 'o.subscription_id IS NOT NULL' },
  order_type: { kind: 'enum', expr: 'o.order_type' },
  edited: {
    kind: 'bool',
    expr: "EXISTS (SELECT 1 FROM order_adjustments oa WHERE oa.order_id = o.id AND oa.status = 'applied')",
  },
  cancel_reason: { kind: 'enum', expr: `(CASE WHEN o.status = 'cancelled' THEN ${CANCEL_REASON_SQL} END)` },

  utm_source: { kind: 'values', expr: 'o.utm_source' },
  utm_medium: { kind: 'values', expr: 'o.utm_medium' },
  utm_campaign: { kind: 'values', expr: 'o.utm_campaign' },
  ad_click: {
    kind: 'enum',
    virtual: { google: GOOGLE_CLICK, meta: META_CLICK, none: `NOT ${GOOGLE_CLICK} AND NOT ${META_CLICK}` },
  },

  fulfillment: {
    kind: 'enum',
    expr: 'ao.fulfillment_channel',
    exists: { from: 'amazon_orders ao', link: 'ao.order_id = o.id' },
  },
  prime: { kind: 'bool', expr: 'EXISTS (SELECT 1 FROM amazon_orders ao WHERE ao.order_id = o.id AND ao.is_prime)' },
}

export const ORDER_SORTS: Record<string, string> = {
  order_number: 'o.order_number',
  customer: 'o.customer_name',
  date: 'o.created_at',
  total: 'o.total_amount',
  status: 'o.status',
  payment: 'o.payment_status',
  source: 'o.source',
  shipped: 'o.shipped_at',
  delivered: 'o.delivered_at',
}

export const ORDERS_ENTITY: FilterEntity<OrderKey> = {
  key: 'orders',
  scope: 'orders:read',
  noun: 'Orders',
  root: 'orders',
  alias: 'o',
  base: ["o.status IS DISTINCT FROM 'draft'"],
  fields: ORDER_FIELDS,
  sql: SQL,
  period: 'created',
  aliases: ORDER_ALIASES,
  search: {
    build: (q, idx) =>
      buildVectorSearchClause(
        q,
        'o.search_vector',
        ['o.customer_name'],
        ['o.order_number', 'o.invoice_number'],
        idx,
        'simple'
      ),
  },
  sorts: ORDER_SORTS,
  facets: true,
  context: async q => {
    if (!q.late_to_ship) return {}
    const [{ getBusinessValues }, { eddSettingsFromValues }] = await Promise.all([
      import('@/lib/catalog/site-controls'),
      import('@/lib/shipping/edd'),
    ])
    return { handlingDays: eddSettingsFromValues(await getBusinessValues().catch(() => null)).handlingDays }
  },
}
