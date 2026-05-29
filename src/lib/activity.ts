import { query } from './db'

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
  | 'login'
  | 'signup'
  | 'address_added'
  | 'address_updated'
  | 'profile_updated'
  | 'flagged'
  | 'unflagged'
  | 'task_created'
  | 'task_completed'

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
  } catch {}
}
