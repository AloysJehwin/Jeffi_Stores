import { query, queryMany } from '@/lib/shared/db'
import { outreachPool } from '../../db'
import { recordEvent } from '../../events'
import type { PhoneOrder, PhoneOrderItem } from './orders'
import { createStaffTask } from './support'

const FULFILLED = new Set(['delivered', 'granted'])
export const isFulfilled = (o: Pick<PhoneOrder, 'status'>) => FULFILLED.has(o.status)

export interface ReviewProduct {
  productId: string
  name: string
  reviewed: boolean
}

/** The order's distinct products and whether this customer already reviewed each (a review is per product and user). */
export async function reviewStatus(o: PhoneOrder, items: PhoneOrderItem[]): Promise<ReviewProduct[]> {
  const seen = new Map<string, string>()
  for (const i of items) if (i.product_id && !seen.has(i.product_id)) seen.set(i.product_id, i.product_name)
  if (!seen.size) return []
  const done = o.user_id
    ? new Set(
        (
          await queryMany<{ product_id: string }>(`SELECT product_id::text FROM product_reviews WHERE user_id = $1::uuid AND product_id = ANY($2::uuid[])`, [o.user_id, [...seen.keys()]])
        ).map(r => r.product_id)
      )
    : new Set<string>()
  return [...seen].map(([productId, name]) => ({ productId, name, reviewed: done.has(productId) }))
}

/** The tokenised no-login review page for one product of a delivered order (48 h). Never shown to the LLM. */
export async function reviewUrl(o: PhoneOrder, productId: string): Promise<string | null> {
  if (!o.user_id) return null
  const { generateReviewToken } = await import('@/lib/auth/jwt')
  const { apiBaseUrl } = await import('@/lib/shared/customer-links')
  const token = await generateReviewToken({ orderId: o.id, productId, userId: o.user_id })
  return `${await apiBaseUrl()}/review?token=${encodeURIComponent(token)}`
}

/**
 * A rating given on the call, kept as feedback the team sees: a customer note on the order (tag complaint for 1 to 3)
 * and, for 3 or below, a staff task. It is not a product_reviews row: that is per product, needs a comment and would
 * block the customer's own review. The same rating on the same job is recorded once.
 */
export async function recordRating(
  o: PhoneOrder,
  a: { rating: number; comment?: string; jobId: string; contactId: string; actor: string }
): Promise<{ alreadyRecorded: boolean; lowRating: boolean; taskCreated: boolean }> {
  const dup = await outreachPool().query(`SELECT 1 FROM outreach_events WHERE contact_id = $1 AND kind = 'agent_rating' AND data->>'jobId' = $2 AND data->>'rating' = $3 LIMIT 1`, [a.contactId, a.jobId, String(a.rating)])
  const low = a.rating <= 3
  if (dup.rows.length) return { alreadyRecorded: true, lowRating: low, taskCreated: false }

  const comment = a.comment?.replace(/\s+/g, ' ').trim().slice(0, 600)
  const body = `Rated ${a.rating}/5 on an outreach call about order #${o.order_number}${comment ? `: "${comment}"` : ''}`
  if (o.user_id) {
    const { createNote } = await import('@/lib/shared/customer-notes')
    await createNote({ userId: o.user_id, adminId: null, body, title: `Call rating ${a.rating}/5`, tags: [low ? 'complaint' : 'other'], orderId: o.id, source: 'admin_panel' })
  } else {
    await query(`UPDATE orders SET admin_notes = CASE WHEN COALESCE(admin_notes, '') = '' THEN $2::text ELSE admin_notes || E'\\n' || $2::text END WHERE id = $1::uuid`, [o.id, `[outreach ${a.jobId}] ${body}`])
  }
  await recordEvent(a.contactId, 'agent_rating', { actor: a.actor, data: { jobId: a.jobId, rating: a.rating, orderNumber: o.order_number, hasComment: !!comment } })

  let taskCreated = false
  if (low) {
    const id = await createStaffTask({
      userId: o.user_id,
      key: `rating:${o.id}`,
      title: `Low rating (${a.rating}/5) on order #${o.order_number}`,
      description: `${body}. Reach out and put it right.`,
      priority: a.rating <= 2 ? 'high' : 'medium',
      dueInDays: 1,
    })
    taskCreated = !!id
  }
  return { alreadyRecorded: false, lowRating: low, taskCreated }
}
