import { queryMany } from '@/lib/shared/db'
import { normalizePhone } from '../../phone'
import type { InputSpec, TriggerSpec } from '../types'
import { withFlagshipStore } from './context'

// SQL polls over the flagship store's tables, like the campaign scenarios (there is no event bus). An event is a
// candidate once event time + delay has passed (the customer stayed idle that long) and it falls in the lookback
// window; dueAt = event time + delay, so a new candidate is normally due at once. createJob dedupes on sourceRef.

export interface TriggerCandidate {
  sourceRef: string
  inputs: Record<string, unknown>
  dueAt: Date
}

const MIN = 60_000
const LIMIT = 200
const DRAFT_LIFE = '30 minutes'

interface Ev {
  phone: string | null
  firstName: string | null
  /** order events: the order number; others: set only when the event is an order */
  orderNumber?: string | null
  checkoutKey?: string
  sourceRef: string
  productId?: string | null
  userId?: string | null
  total?: number | null
  orderCreatedAt?: Date | string | null
  deliveredAt?: Date | string | null
  eventAt: Date
}

interface OrderRow {
  id: string
  order_number: string
  user_id: string | null
  total: number
  created_at: Date
  delivered_at: Date | null
  customer_phone: string | null
  user_phone: string | null
  first_name: string | null
  product_id: string | null
  event_at: Date
}

const FIRST = (a: string, b: string) => `COALESCE(NULLIF(split_part(trim(COALESCE(${a}, '')), ' ', 1), ''), NULLIF(split_part(trim(COALESCE(${b}, '')), ' ', 1), ''))`
const ORDER_SELECT = `
  SELECT o.id::text AS id, o.order_number, o.user_id::text AS user_id, o.total_amount::float AS total, o.created_at, o.delivered_at,
         o.customer_phone, u.phone AS user_phone, ${FIRST('u.first_name', 'o.customer_name')} AS first_name,
         (SELECT oi.product_id::text FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.created_at, oi.id LIMIT 1) AS product_id,
         %EVENT% AS event_at
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
   WHERE o.source = 'online' AND o.draft_of_id IS NULL`
const LATER_ORDER = (userCol: string, afterCol: string) =>
  `NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.user_id = ${userCol} AND o2.created_at > ${afterCol} AND o2.status <> 'cancelled' AND o2.draft_of_id IS NULL)`

const pickPhone = (...c: (string | null | undefined)[]) => c.map(normalizePhone).find(Boolean) ?? null

function orderEv(r: OrderRow, sourceRef = r.order_number): Ev {
  return {
    phone: pickPhone(r.customer_phone, r.user_phone), firstName: r.first_name, orderNumber: r.order_number, sourceRef, productId: r.product_id,
    userId: r.user_id, total: r.total, orderCreatedAt: r.created_at, deliveredAt: r.delivered_at, eventAt: new Date(r.event_at),
  }
}

/** `when` filters the order events understand: payment_method (cod, ...), min_total (rupees). */
function whenSql(when: TriggerSpec['when'], params: unknown[]): string {
  const out: string[] = []
  if (when.payment_method != null) {
    params.push(String(when.payment_method).toLowerCase())
    out.push(`lower(o.payment_mode) = $${params.length}`)
  }
  if (when.min_total != null && Number.isFinite(Number(when.min_total))) {
    params.push(Number(when.min_total))
    out.push(`o.total_amount >= $${params.length}`)
  }
  return out.length ? ` AND ${out.join(' AND ')}` : ''
}

async function orderEvents(event: TriggerSpec['event'], t: TriggerSpec, from: Date, to: Date): Promise<Ev[]> {
  const params: unknown[] = [from, to]
  let sql: string
  if (event === 'order.delivered') {
    sql = `${ORDER_SELECT.replace('%EVENT%', 'o.delivered_at')} AND o.status IN ('delivered', 'granted') AND o.delivered_at > $1 AND o.delivered_at <= $2`
  } else if (event === 'order.placed') {
    sql = `${ORDER_SELECT.replace('%EVENT%', 'o.created_at')} AND o.created_at > $1 AND o.created_at <= $2 AND o.status NOT IN ('cancelled', 'refunded')`
  } else if (event === 'payment.failed') {
    sql = `${ORDER_SELECT.replace('%EVENT%', 'o.updated_at')} AND o.payment_status = 'failed' AND o.updated_at > $1 AND o.updated_at <= $2`
  } else {
    // review.missing: delivered, and the customer reviewed none of the order's products.
    sql = `${ORDER_SELECT.replace('%EVENT%', 'o.delivered_at')} AND o.status IN ('delivered', 'granted') AND o.delivered_at > $1 AND o.delivered_at <= $2 AND o.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM product_reviews pr JOIN order_items oi ON oi.product_id = pr.product_id WHERE oi.order_id = o.id AND pr.user_id = o.user_id)`
  }
  sql += `${whenSql(t.when, params)} ORDER BY event_at LIMIT ${LIMIT}`
  return (await queryMany<OrderRow>(sql, params)).map(r => orderEv(r))
}

async function checkoutEvents(from: Date, to: Date): Promise<Ev[]> {
  const [carts, cancelled, intents] = await Promise.all([
    queryMany<{ user_id: string; event_at: Date; total: number; user_phone: string | null; first_name: string | null; product_id: string | null }>(
      `WITH c AS (
         SELECT ci.user_id, max(ci.updated_at) AS event_at, sum(ci.price_at_addition * ci.quantity)::float AS total, u.phone AS user_phone,
                NULLIF(split_part(trim(COALESCE(u.first_name, '')), ' ', 1), '') AS first_name, (array_agg(ci.product_id::text ORDER BY ci.updated_at DESC))[1] AS product_id
           FROM cart_items ci JOIN users u ON u.id = ci.user_id
          WHERE ci.saved_for_later = FALSE AND u.is_active = TRUE AND u.is_guest = FALSE AND u.phone IS NOT NULL
          GROUP BY ci.user_id, u.phone, u.first_name)
       SELECT c.user_id::text, c.event_at, c.total, c.user_phone, c.first_name, c.product_id FROM c
        WHERE c.event_at > $1 AND c.event_at <= $2 AND ${LATER_ORDER('c.user_id', 'c.event_at')}
        ORDER BY c.event_at LIMIT ${LIMIT}`,
      [from, to]
    ),
    queryMany<OrderRow>(
      `${ORDER_SELECT.replace('%EVENT%', 'o.updated_at')} AND o.status = 'cancelled' AND o.payment_status = 'cancelled'
         AND (o.updated_at - o.created_at) <= interval '15 minutes' AND o.updated_at > $1 AND o.updated_at <= $2
         AND (o.user_id IS NULL OR ${LATER_ORDER('o.user_id', 'o.created_at')})
       ORDER BY event_at LIMIT ${LIMIT}`,
      [from, to]
    ),
    queryMany<{ id: string; user_id: string; total: number; user_phone: string | null; first_name: string | null; event_at: Date }>(
      `SELECT pi.id::text, pi.user_id::text, (pi.amount_paise / 100.0)::float AS total, u.phone AS user_phone,
              NULLIF(split_part(trim(COALESCE(u.first_name, '')), ' ', 1), '') AS first_name, pi.created_at + interval '${DRAFT_LIFE}' AS event_at
         FROM pending_payment_intents pi JOIN users u ON u.id = pi.user_id
        WHERE pi.committed = FALSE AND u.is_active = TRUE AND u.phone IS NOT NULL
          AND pi.created_at + interval '${DRAFT_LIFE}' > $1 AND pi.created_at + interval '${DRAFT_LIFE}' <= $2
          AND ${LATER_ORDER('pi.user_id', 'pi.created_at')}
          AND NOT EXISTS (SELECT 1 FROM pending_payment_intents p2 WHERE p2.user_id = pi.user_id AND p2.committed = TRUE AND p2.created_at > pi.created_at)
        ORDER BY event_at LIMIT ${LIMIT}`,
      [from, to]
    ),
  ])
  const evs: Ev[] = [
    // One job per cart episode: the key is the cart, the dedupe key adds the day it last changed.
    ...carts.map<Ev>(r => ({
      phone: pickPhone(r.user_phone), firstName: r.first_name, checkoutKey: `cart:${r.user_id}`, sourceRef: `cart:${r.user_id}:${new Date(r.event_at).toISOString().slice(0, 10)}`,
      productId: r.product_id, userId: r.user_id, total: r.total, eventAt: new Date(r.event_at),
    })),
    ...cancelled.map<Ev>(r => ({ ...orderEv(r, `order:${r.id}`), checkoutKey: `order:${r.id}` })),
    ...intents.map<Ev>(r => ({
      phone: pickPhone(r.user_phone), firstName: r.first_name, checkoutKey: `intent:${r.id}`, sourceRef: `intent:${r.id}`, userId: r.user_id, total: r.total, eventAt: new Date(r.event_at),
    })),
  ]
  // A customer with a cart and a failed payment is one recovery, the latest event.
  const byUser = new Map<string, Ev>()
  for (const e of evs) {
    const k = e.userId ?? e.sourceRef
    const cur = byUser.get(k)
    if (!cur || e.eventAt > cur.eventAt) byUser.set(k, e)
  }
  return [...byUser.values()].sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime())
}

const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : undefined)

/** Fills each declared input from the event by role and type; undefined when the event has nothing for it. */
function fill(name: string, s: InputSpec, e: Ev): unknown {
  if (s.role === 'contact') return e.phone ?? undefined
  if (s.role === 'name') return e.firstName ?? (s.required ? 'there' : undefined)
  if (s.role === 'language') return undefined
  switch (s.type) {
    case 'phone': return e.phone ?? undefined
    case 'order_ref': return e.orderNumber ?? undefined
    case 'checkout_ref': return e.checkoutKey
    case 'product_ref': return e.productId ?? undefined
    case 'customer_ref': return e.userId ?? undefined
    case 'money': return e.total ?? undefined
    case 'number': return undefined
    case 'datetime':
    case 'date': {
      const n = name.toLowerCase()
      const v = n.includes('deliver') ? e.deliveredAt : n.includes('order') || n.includes('placed') ? e.orderCreatedAt : e.eventAt
      const t = iso(v ?? e.eventAt)
      return s.type === 'date' ? t?.slice(0, 10) : t
    }
    default: return undefined
  }
}

/**
 * Jobs the trigger's event calls for right now: inputs filled from the event, the dedupe key as sourceRef, due at event
 * time + delay. Events with no usable phone, or missing a required input, are skipped.
 */
export async function findTriggerCandidates(trigger: TriggerSpec, inputs: Record<string, InputSpec>, now: Date): Promise<TriggerCandidate[]> {
  if (trigger.event === 'manual') return []
  const to = new Date(now.getTime() - trigger.delayMinutes * MIN)
  const from = new Date(to.getTime() - Math.max(trigger.lookbackMinutes, MIN) * MIN)
  const events = await withFlagshipStore(() => (trigger.event === 'checkout.abandoned' ? checkoutEvents(from, to) : orderEvents(trigger.event, trigger, from, to)))
  const out: TriggerCandidate[] = []
  for (const e of events) {
    if (!e.phone) continue
    const values: Record<string, unknown> = {}
    let complete = true
    for (const [name, s] of Object.entries(inputs)) {
      const v = fill(name, s, e)
      if (v === undefined) {
        if (s.required) complete = false
        continue
      }
      values[name] = v
    }
    if (!complete) continue
    out.push({ sourceRef: e.sourceRef, inputs: values, dueAt: new Date(e.eventAt.getTime() + trigger.delayMinutes * MIN) })
  }
  return out
}
