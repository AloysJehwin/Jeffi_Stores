import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { openReplyContextSafe } from './context'
import { withReplyContext } from './scope'
import type { ScenarioKey } from './types'

/** Send something that asks an order's customer a question: their reply comes back to this record. */
export async function askAboutOrder<T>(
  scenario: ScenarioKey,
  orderId: string,
  send: () => Promise<T>,
  opts: { entityType?: 'orders' | 'invoices'; refId?: string | null } = {}
): Promise<T> {
  const o = await queryOne<{ user_id: string | null; email: string | null; phone: string | null }>(
    `SELECT o.user_id, COALESCE(NULLIF(u.email, ''), o.customer_email) AS email, COALESCE(NULLIF(u.phone, ''), o.customer_phone) AS phone
       FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
    [orderId]
  ).catch(() => null)
  const entityType = opts.entityType ?? 'orders'
  const opened = o
    ? await openReplyContextSafe({ scenario, entityType, entityId: orderId, refId: opts.refId ?? null, userId: o.user_id, email: o.email?.toLowerCase() ?? null, phone: o.phone })
    : null
  return withReplyContext(opened ? { contextId: opened.context.id, replyTo: opened.replyTo, entityType, entityId: orderId } : null, send)
}
