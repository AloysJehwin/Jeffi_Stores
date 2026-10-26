import 'server-only'
import { buildWhere, type FilterQuery, type ScopeSql } from '@jeffi/list-filters'
import { queryOne, queryMany, queryCount } from './shared'
import { CYCLE_PAISE_SQL, SUBSCRIPTIONS_ENTITY } from '@/lib/filters/entities/subscriptions'
import {
  SUBSCRIPTION_INTERVAL_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  isSubscriptionInterval,
} from '@/lib/subscriptions/intervals'

export const ADMIN_SUBSCRIPTIONS_PAGE_SIZE = 25

// Monthly normalisation of the per-cycle amount (weekly*52/12, quarterly/3, yearly/12).
const MONTHLY_FACTOR_SQL = `CASE s.interval WHEN 'weekly' THEN 52.0 / 12 WHEN 'quarterly' THEN 1.0 / 3 WHEN 'yearly' THEN 1.0 / 12 ELSE 1 END`

export interface AdminSubscriptionStats {
  active: number
  paused: number
  halted: number
  cancelled: number
  mrr: number
}

export interface AdminSubscriptionListItem {
  id: string
  status: string
  statusLabel: string
  customerId: string
  customerName: string
  customerEmail: string | null
  productId: string
  productName: string
  isDigital: boolean
  interval: string | null
  intervalLabel: string
  quantity: number
  amount: number
  currentCycle: number
  /** Fixed number of charges, or null = until cancelled. */
  totalCycles: number | null
  currentEnd: string | null
  cancelAtCycleEnd: boolean
  collectingAccount: string
  razorpaySubscriptionId: string | null
  createdAt: string
}

interface ListRow {
  id: string
  status: string
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  product_id: string
  product_name: string
  is_digital: boolean
  interval: string | null
  quantity: string
  cycle_paise: string
  current_cycle: number
  term_cycles: number | null
  current_end: string | null
  cancel_at_cycle_end: boolean
  collecting_account: string
  razorpay_subscription_id: string | null
  created_at: string
}

export const statusLabel = (s: string) => SUBSCRIPTION_STATUS_LABELS[s] ?? s
export const intervalLabel = (i: string | null) => (isSubscriptionInterval(i) ? SUBSCRIPTION_INTERVAL_LABELS[i] : i || '—')

const fullName = (r: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Customer'

function toItem(r: ListRow): AdminSubscriptionListItem {
  return {
    id: r.id,
    status: r.status,
    statusLabel: statusLabel(r.status),
    customerId: r.user_id,
    customerName: fullName(r),
    customerEmail: r.email,
    productId: r.product_id,
    productName: r.product_name,
    isDigital: r.is_digital,
    interval: r.interval,
    intervalLabel: intervalLabel(r.interval),
    quantity: Number(r.quantity),
    amount: Math.round(Number(r.cycle_paise)) / 100,
    currentCycle: r.current_cycle,
    totalCycles: r.term_cycles,
    currentEnd: r.current_end,
    cancelAtCycleEnd: r.cancel_at_cycle_end,
    collectingAccount: r.collecting_account,
    razorpaySubscriptionId: r.razorpay_subscription_id,
    createdAt: r.created_at,
  }
}

/** `scope`: the list's filters on alias s (from filterScope(...).and(1)). */
export async function getAdminSubscriptionStats(scope?: ScopeSql): Promise<AdminSubscriptionStats> {
  const row = await queryOne<{ active: number; paused: number; halted: number; cancelled: number; mrr_paise: string }>(
    `SELECT COUNT(*) FILTER (WHERE s.status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE s.status = 'paused')::int AS paused,
            COUNT(*) FILTER (WHERE s.status = 'halted')::int AS halted,
            COUNT(*) FILTER (WHERE s.status = 'cancelled')::int AS cancelled,
            COALESCE(SUM(${CYCLE_PAISE_SQL} * ${MONTHLY_FACTOR_SQL}) FILTER (WHERE s.status = 'active'), 0)::text AS mrr_paise
       FROM subscriptions s
      WHERE s.source <> 'legacy'${scope?.sql ?? ''}`,
    scope?.params
  )
  return {
    active: row?.active ?? 0,
    paused: row?.paused ?? 0,
    halted: row?.halted ?? 0,
    cancelled: row?.cancelled ?? 0,
    mrr: Math.round(Number(row?.mrr_paise ?? 0)) / 100,
  }
}

export async function listAdminSubscriptions(filters: { status?: string; q?: string; page?: number }) {
  const page = Math.max(1, Math.floor(filters.page || 1))
  const conditions = [`s.source <> 'legacy'`]
  const params: unknown[] = []
  if (filters.status && SUBSCRIPTION_STATUS_LABELS[filters.status]) {
    params.push(filters.status)
    conditions.push(`s.status = $${params.length}`)
  }
  const q = filters.q?.trim()
  if (q) {
    params.push(`%${q}%`)
    const n = params.length
    conditions.push(
      `(u.email ILIKE $${n} OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $${n} OR p.name ILIKE $${n} OR s.razorpay_subscription_id ILIKE $${n})`
    )
  }
  return selectSubscriptions(`WHERE ${conditions.join(' AND ')}`, params, page)
}

/** One page for a normalised filter query (the admin list). */
export async function queryAdminSubscriptions(q: FilterQuery, page = 1) {
  const w = buildWhere(SUBSCRIPTIONS_ENTITY, q, 1)
  return selectSubscriptions(w.where, w.params, Math.max(1, Math.floor(page)))
}

async function selectSubscriptions(where: string, params: unknown[], page: number) {
  const from = `FROM subscriptions s JOIN users u ON u.id = s.user_id JOIN products p ON p.id = s.product_id`
  const offset = (page - 1) * ADMIN_SUBSCRIPTIONS_PAGE_SIZE

  const [rows, total] = await Promise.all([
    queryMany<ListRow>(
      `SELECT s.id::text, s.status, s.user_id::text, u.first_name, u.last_name, u.email,
              s.product_id::text, p.name AS product_name, s.is_digital, s.interval, s.quantity::text,
              ${CYCLE_PAISE_SQL}::text AS cycle_paise, s.current_cycle, s.term_cycles, s.current_end::text,
              s.cancel_at_cycle_end, s.collecting_account, s.razorpay_subscription_id, s.created_at::text
         ${from} ${where}
        ORDER BY s.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, ADMIN_SUBSCRIPTIONS_PAGE_SIZE, offset]
    ),
    queryCount(`SELECT COUNT(*) ${from} ${where}`, params),
  ])

  return { items: rows.map(toItem), total, page, pageSize: ADMIN_SUBSCRIPTIONS_PAGE_SIZE }
}

export interface AdminSubscriptionCycle {
  id: string
  cycleNumber: number
  amount: number
  status: string
  razorpayPaymentId: string
  razorpayInvoiceId: string | null
  createdAt: string
  order: { id: string; orderNumber: string; status: string; paymentStatus: string; total: number } | null
}

export async function getAdminSubscriptionDetail(id: string) {
  const sub = await queryOne<Record<string, unknown> & { user_id: string; product_id: string; status: string; interval: string | null }>(
    `SELECT s.*, ${CYCLE_PAISE_SQL}::text AS cycle_paise FROM subscriptions s WHERE s.id = $1 AND s.source <> 'legacy'`,
    [id]
  )
  if (!sub) return null

  const [customer, product, cycleRows] = await Promise.all([
    queryOne<{ id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }>(
      `SELECT id::text, first_name, last_name, email, phone FROM users WHERE id = $1`,
      [sub.user_id]
    ),
    queryOne<{ id: string; name: string; slug: string | null; image_url: string | null }>(
      `SELECT p.id::text, p.name, p.slug,
              (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url
         FROM products p WHERE p.id = $1`,
      [sub.product_id]
    ),
    queryMany<{
      id: string
      cycle_number: number
      amount_paise: string
      status: string
      razorpay_payment_id: string
      razorpay_invoice_id: string | null
      created_at: string
      order_id: string | null
      order_number: string | null
      order_status: string | null
      payment_status: string | null
      total_amount: string | null
    }>(
      `SELECT c.id::text, c.cycle_number, c.amount_paise::text, c.status, c.razorpay_payment_id,
              c.razorpay_invoice_id, c.created_at::text, o.id::text AS order_id, o.order_number,
              o.status AS order_status, o.payment_status, o.total_amount::text
         FROM subscription_cycle_orders c
         LEFT JOIN orders o ON o.id = c.order_id
        WHERE c.subscription_id = $1
        ORDER BY c.cycle_number DESC`,
      [id]
    ),
  ])

  const cycles: AdminSubscriptionCycle[] = cycleRows.map(c => ({
    id: c.id,
    cycleNumber: c.cycle_number,
    amount: Number(c.amount_paise) / 100,
    status: c.status,
    razorpayPaymentId: c.razorpay_payment_id,
    razorpayInvoiceId: c.razorpay_invoice_id,
    createdAt: c.created_at,
    order: c.order_id
      ? {
          id: c.order_id,
          orderNumber: c.order_number || '',
          status: c.order_status || '',
          paymentStatus: c.payment_status || '',
          total: Number(c.total_amount || 0),
        }
      : null,
  }))

  return {
    subscription: {
      ...sub,
      statusLabel: statusLabel(sub.status),
      intervalLabel: intervalLabel(sub.interval),
      amount: Math.round(Number(sub.cycle_paise)) / 100,
      totalCycles: sub.term_cycles != null ? Number(sub.term_cycles) : null,
    },
    customer: customer ? { ...customer, name: fullName(customer) } : null,
    product,
    cycles,
  }
}

export type AdminSubscriptionDetail = NonNullable<Awaited<ReturnType<typeof getAdminSubscriptionDetail>>>
