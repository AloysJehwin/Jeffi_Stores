import { queryOne } from '@/lib/shared/db'
import { phoneMatchSql, phone10 } from '@/lib/orders/by-phone'
import { REF_TYPES, type CustomerRef, type InputSpec, type ResolvedRefs } from '../types'
import { toProductRef } from './catalog'
import { loadCheckout } from './checkout'
import { withFlagshipStore } from './context'
import { iso } from './format'
import { loadOrder } from './orders'

async function customerRef(userId: string, phone: string): Promise<CustomerRef | null> {
  const p = phone10(phone)
  if (p.length < 10 || !/^[0-9a-f-]{36}$/i.test(userId)) return null
  const u = await queryOne<{ id: string; first_name: string | null; orders: number; last_order_at: Date | null }>(
    `SELECT u.id::text, NULLIF(trim(u.first_name), '') AS first_name,
            (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id AND o.draft_of_id IS NULL AND o.status <> 'cancelled') AS orders,
            (SELECT max(o.created_at) FROM orders o WHERE o.user_id = u.id AND o.draft_of_id IS NULL AND o.status <> 'cancelled') AS last_order_at
       FROM users u WHERE u.id = $1::uuid AND ${phoneMatchSql('u.phone', '$2')}`,
    [userId, p]
  )
  return u ? { userId: u.id, firstName: u.first_name, orderCount: u.orders, lastOrderAt: iso(u.last_order_at) } : null
}

/**
 * Resolves a job's reference inputs into safe summaries, each checked against the contact's phone (an order, cart or
 * account must belong to that number). One error line per reference that does not resolve; a missing value is not an
 * error here (createJob checks required inputs).
 */
export async function resolveRefs(inputs: Record<string, unknown>, spec: Record<string, InputSpec>, contactPhone: string): Promise<{ refs: ResolvedRefs; errors: string[] }> {
  const refs: ResolvedRefs = {}
  const errors: string[] = []
  await withFlagshipStore(async () => {
    for (const [name, s] of Object.entries(spec)) {
      if (!REF_TYPES.includes(s.type)) continue
      const raw = inputs[name]
      const val = raw == null ? '' : String(raw).trim()
      if (!val) continue
      if (s.type === 'order_ref') {
        if (refs.order) continue
        const o = await loadOrder(val, contactPhone)
        if (o) refs.order = o.ref
        else errors.push(`${name}: order ${val} not found for this phone`)
      } else if (s.type === 'checkout_ref') {
        if (refs.checkout) continue
        const c = await loadCheckout(val, contactPhone)
        if (c) refs.checkout = c.ref
        else errors.push(`${name}: checkout ${val} not found for this phone`)
      } else if (s.type === 'product_ref') {
        if (refs.product) continue
        const p = await toProductRef(val)
        if (p) refs.product = p
        else errors.push(`${name}: product ${val} not found`)
      } else if (s.type === 'customer_ref') {
        if (refs.customer) continue
        const c = await customerRef(val, contactPhone)
        if (c) refs.customer = c
        else errors.push(`${name}: customer not found for this phone`)
      }
    }
  })
  return { refs, errors }
}
