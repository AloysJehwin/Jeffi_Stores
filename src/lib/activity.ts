import { query } from './db'
import { categoryFor } from './activity-shared'

export { categoryFor }
export type { ActivityCategory } from './activity-shared'

export type ActivityKind =
  | 'order_placed'
  | 'order_status'
  | 'payment_status'
  | 'return_requested'
  | 'return_status'
  | 'tag_added'
  | 'tag_removed'
  | 'note_added'
  | 'support_message'
  | 'support_session_started'
  | 'login'
  | 'logout'
  | 'signup'
  | 'address_added'
  | 'address_updated'
  | 'address_removed'
  | 'profile_updated'
  | 'password_changed'
  | 'wishlist_added'
  | 'wishlist_removed'
  | 'review_submitted'
  | 'cart_abandoned'
  | 'cart_item_added'
  | 'cart_item_removed'
  | 'product_viewed'
  | 'flagged'
  | 'unflagged'
  | 'task_created'
  | 'task_completed'
  | 'marketing_opted_out'
  | 'marketing_opted_in'

interface LogActivityParams {
  userId: string
  actorId?: string | null
  kind: ActivityKind
  referenceId?: string | null
  referenceType?: string | null
  summary: string
  metadata?: Record<string, unknown>
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await query(
      `INSERT INTO customer_activity_log
         (user_id, actor_id, kind, reference_id, reference_type, summary, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.userId,
        params.actorId ?? null,
        params.kind,
        params.referenceId ?? null,
        params.referenceType ?? null,
        params.summary,
        JSON.stringify(params.metadata ?? {}),
      ]
    )
  } catch (err: any) {
    try {
      await query(
        `INSERT INTO _debug_log (source, payload) VALUES ($1, $2)`,
        ['logActivity', JSON.stringify({ kind: params.kind, userId: params.userId, summary: params.summary, msg: err?.message, code: err?.code, detail: err?.detail })]
      )
    } catch {}
  }
}
