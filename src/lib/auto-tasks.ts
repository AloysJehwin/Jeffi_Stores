import { query, queryOne } from './db'
import { logActivity } from './activity'

export type AutoTaskKind =
  | 'review_return'
  | 'schedule_pickup'
  | 'inspect_refund'
  | 'process_refund'
  | 'chase_refund'
  | 'contact_failed_payment'
  | 'abandoned_checkout'
  | 'confirm_cod_payment'
  | 'review_high_value_order'
  | 'process_confirmed'
  | 'stuck_processing'
  | 'stuck_shipment'
  | 'ndr_check'
  | 'address_rto'
  | 'review_flagged'
  | 'b2b_welcome'
  | 'collect_gst'
  | 'vip_check_in'
  | 'winback'
  | 'lead_followup'
  | 'respond_review'
  | 'support_pickup'
  | 'support_urgent'
  | 'followup_quote'
  | 'chase_quote_payment'
  | 'login_anomaly'
  | 'save_customer'

export type Priority = 'low' | 'medium' | 'high' | 'urgent'

interface CreateAutoTaskParams {
  userId: string
  sourceKind: AutoTaskKind
  sourceRefId: string
  title: string
  description?: string
  priority?: Priority
  dueInDays?: number | null
}

let cachedSuperAdminId: string | null = null
let cachedAt = 0
const CACHE_MS = 5 * 60 * 1000

export function __resetSuperAdminCache(): void {
  cachedSuperAdminId = null
  cachedAt = 0
}

async function getSuperAdminId(): Promise<string | null> {
  if (cachedSuperAdminId && Date.now() - cachedAt < CACHE_MS) return cachedSuperAdminId
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM admins WHERE role = 'super_admin' AND is_active = true ORDER BY created_at LIMIT 1`
  )
  if (row?.id) {
    cachedSuperAdminId = row.id
    cachedAt = Date.now()
  }
  return row?.id ?? null
}

export async function createAutoTask(params: CreateAutoTaskParams): Promise<string | null> {
  try {
    const superAdminId = await getSuperAdminId()
    const dueDate = params.dueInDays != null
      ? new Date(Date.now() + params.dueInDays * 86400000).toISOString().slice(0, 10)
      : null

    const result = await query<{ id: string }>(
      `INSERT INTO customer_tasks
         (user_id, created_by, assigned_to, title, description, due_date, priority,
          source_kind, source_ref_id, auto_created)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8::text, $9::text, TRUE
       WHERE NOT EXISTS (
         SELECT 1 FROM customer_tasks
         WHERE source_kind = $8::text AND source_ref_id = $9::text
           AND status IN ('pending', 'in_progress')
       )
       RETURNING id`,
      [
        params.userId,
        superAdminId,
        superAdminId,
        params.title.slice(0, 255),
        params.description ? params.description.slice(0, 2000) : null,
        dueDate,
        params.priority ?? 'medium',
        params.sourceKind,
        params.sourceRefId,
      ]
    )

    const taskId = result.rows[0]?.id
    if (taskId) {
      logActivity({
        userId: params.userId,
        kind: 'task_created',
        referenceId: taskId,
        referenceType: 'customer_tasks',
        summary: `Auto-task: ${params.title}`,
        metadata: { sourceKind: params.sourceKind, sourceRefId: params.sourceRefId, auto: true },
      }).catch(() => {})
    }
    return taskId ?? null
  } catch (err) {
    console.error('[route]', err)
    return null
  }
}

export async function completeAutoTask(
  sourceKind: AutoTaskKind,
  sourceRefId: string,
  options: { actorAdminId?: string | null } = {}
): Promise<void> {
  try {
    const result = await query<{ id: string; user_id: string; title: string }>(
      `UPDATE customer_tasks
       SET status = 'completed',
           completed_at = NOW(),
           completed_by = $1,
           updated_at = NOW()
       WHERE source_kind = $2 AND source_ref_id = $3
         AND status IN ('pending', 'in_progress')
       RETURNING id, user_id, title`,
      [options.actorAdminId ?? null, sourceKind, sourceRefId]
    )
    for (const row of result.rows) {
      logActivity({
        userId: row.user_id,
        actorId: options.actorAdminId ?? null,
        kind: 'task_completed',
        referenceId: row.id,
        referenceType: 'customer_tasks',
        summary: `Auto-task closed: ${row.title}`,
      }).catch(() => {})
    }
  } catch {}
}
