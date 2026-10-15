import { query } from '@/lib/shared/db'
import type { NextRequest } from 'next/server'

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'activate'
  | 'deactivate'
  | 'feature'
  | 'unfeature'
  | 'inventory_adjust'
  | 'price_change'
  | 'login'
  | 'logout'
  | 'permission_change'
  | 'export'
  | 'import'
  | 'send'
  | 'approve'
  | 'reject'

export type AuditEntity =
  | 'product'
  | 'brand'
  | 'category'
  | 'inventory'
  | 'coupon'
  | 'campaign'
  | 'mailer_template'
  | 'admin'
  | 'order'
  | 'quotation'
  | 'invoice'
  | 'customer'
  | 'system'

interface AuditParams {
  adminId: string | null
  action: AuditAction
  entityType: AuditEntity | string
  entityId?: string | null
  summary: string
  diff?: Record<string, { from: unknown; to: unknown }> | null
  metadata?: Record<string, unknown>
  request?: NextRequest | null
}

export async function logAdminAudit(params: AuditParams): Promise<void> {
  try {
    const ip =
      params.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      params.request?.headers.get('x-real-ip') ||
      null
    const ua = params.request?.headers.get('user-agent') || null
    await query(
      `INSERT INTO admin_audit_log
         (admin_id, action, entity_type, entity_id, summary, diff, metadata, ip_address, user_agent)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::inet, $9)`,
      [
        params.adminId,
        params.action,
        params.entityType,
        params.entityId ?? null,
        params.summary,
        params.diff ? JSON.stringify(params.diff) : null,
        JSON.stringify(params.metadata ?? {}),
        ip,
        ua,
      ]
    )
  } catch (err: any) {
    try {
      await query(`INSERT INTO _debug_log (source, payload) VALUES ($1, $2)`, [
        'logAdminAudit',
        JSON.stringify({
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          msg: err?.message,
          code: err?.code,
        }),
      ])
    } catch {}
  }
}

export function diffOf<T extends Record<string, any>>(
  before: T | null,
  after: T | null,
  fields: (keyof T)[]
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  if (!before || !after) return out
  for (const f of fields) {
    const a = before[f]
    const b = after[f]
    const aS = a === null || a === undefined ? null : typeof a === 'object' ? JSON.stringify(a) : a
    const bS = b === null || b === undefined ? null : typeof b === 'object' ? JSON.stringify(b) : b
    if (aS !== bS) out[String(f)] = { from: a ?? null, to: b ?? null }
  }
  return out
}
