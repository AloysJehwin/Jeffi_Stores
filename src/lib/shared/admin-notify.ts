import { query, queryMany } from '@/lib/shared/db'
import { hasScope } from '@/lib/auth/scopes'

export type AdminNotificationCategory = 'orders' | 'returns' | 'reviews' | 'b2b' | 'support' | 'kyc' | 'inventory'

export type AdminNotificationSeverity = 'info' | 'warning' | 'critical'

export interface AdminNotification {
  id: string
  type: string
  category: AdminNotificationCategory
  title: string
  message: string | null
  link: string | null
  entity_type: string | null
  entity_id: string | null
  severity: AdminNotificationSeverity
  scope: string | null
  is_read: boolean
  created_at: string
}

interface CreateParams {
  type: string
  category: AdminNotificationCategory
  title: string
  message?: string | null
  link?: string | null
  entityType?: string | null
  entityId?: string | null
  severity?: AdminNotificationSeverity
  scope?: string | null
}

export async function createAdminNotification(params: CreateParams): Promise<void> {
  try {
    if (params.entityType && params.entityId) {
      const existing = await query(
        `SELECT 1 FROM admin_notifications
         WHERE entity_type = $1 AND entity_id = $2 AND type = $3 AND is_read = false
         LIMIT 1`,
        [params.entityType, params.entityId, params.type]
      )
      if (existing.rowCount && existing.rowCount > 0) return
    }
    await query(
      `INSERT INTO admin_notifications
         (type, category, title, message, link, entity_type, entity_id, severity, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        params.type,
        params.category,
        params.title,
        params.message ?? null,
        params.link ?? null,
        params.entityType ?? null,
        params.entityId ?? null,
        params.severity ?? 'info',
        params.scope ?? null,
      ]
    )
  } catch (err: any) {
    try {
      await query(`INSERT INTO _debug_log (source, payload) VALUES ($1, $2)`, [
        'createAdminNotification',
        JSON.stringify({ type: params.type, title: params.title, msg: err?.message, code: err?.code }),
      ])
    } catch {}
  }
}

function visible(row: AdminNotification, role: string, scopes: string[]): boolean {
  return !row.scope || hasScope(role, scopes, row.scope)
}

export async function listAdminNotifications(
  role: string,
  scopes: string[],
  limit = 30
): Promise<{ items: AdminNotification[]; unreadCount: number }> {
  const rows = await queryMany<AdminNotification>(
    `SELECT id, type, category, title, message, link, entity_type, entity_id,
            severity, scope, is_read, created_at
     FROM admin_notifications
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 100))]
  )
  const items = rows.filter(r => visible(r, role, scopes))
  const unreadCount = items.filter(r => !r.is_read).length
  return { items, unreadCount }
}

export async function markRead(ids: string[]): Promise<void> {
  if (!ids.length) return
  await query(
    `UPDATE admin_notifications SET is_read = true, read_at = now()
     WHERE id = ANY($1::uuid[]) AND is_read = false`,
    [ids]
  )
}

export async function markAllRead(): Promise<void> {
  await query(`UPDATE admin_notifications SET is_read = true, read_at = now() WHERE is_read = false`, [])
}
