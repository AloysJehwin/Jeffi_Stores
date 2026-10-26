import { NextRequest, NextResponse } from 'next/server'
import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { authenticateAdmin, authenticateServiceAccount } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { AUDIT_ENTITY } from '@/lib/filters/entities/audit'
import { LOG_COUNT_CAP } from '@/lib/filters/fields/audit'
import { cappedCount } from '@/lib/filters/run'
import { listWindow } from '@/lib/filters/window'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'audit:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.min(200, Math.max(10, parseInt(url.searchParams.get('pageSize') || '50', 10)))
  const offset = (page - 1) * pageSize
  // The list filters; without dates, the last 7 days. The count stops at LOG_COUNT_CAP.
  const { q, window } = listWindow(AUDIT_ENTITY, normalizeQuery(AUDIT_ENTITY, url.searchParams))
  const w = buildWhere(AUDIT_ENTITY, q)
  const n = w.params.length

  const [rows, counted] = await Promise.all([
    queryMany(
      `SELECT l.id::text, l.admin_id::text, l.action, l.entity_type, l.entity_id,
              l.summary, l.diff, l.metadata, l.ip_address::text, l.created_at,
              u.first_name AS admin_first_name, u.last_name AS admin_last_name,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS admin_username
         FROM admin_audit_log l
         LEFT JOIN admins a ON a.id = l.admin_id
         LEFT JOIN users u ON u.id = a.user_id
        ${w.where}
        ORDER BY l.created_at DESC
        LIMIT $${n + 1}
        OFFSET $${n + 2}`,
      [...w.params, pageSize, offset]
    ),
    cappedCount(AUDIT_ENTITY, q, LOG_COUNT_CAP),
  ])

  return NextResponse.json({ events: rows, total: counted.count, capped: counted.capped, window, page, pageSize })
}

// POST — called by service accounts or the CRON_SECRET bearer to write audit entries.
// Auth: mTLS service account with audit:write scope, OR admin session with audit:write.
export async function POST(req: NextRequest) {
  const cronOk = verifyCronRequest(req)

  const sa = await authenticateServiceAccount(req)
  const admin = !sa && !cronOk ? await authenticateAdmin(req) : null

  if (!sa && !cronOk && !admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (sa && !sa.allowed_scopes.includes('audit:write') && !sa.allowed_scopes.includes('audit')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (admin && !hasScope(admin.role, admin.scopes, 'audit:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: {
    action?: string
    entity_type?: string
    entity_id?: string | null
    summary?: string
    diff?: Record<string, { from: unknown; to: unknown }> | null
    metadata?: Record<string, unknown>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validActions = [
    'create',
    'update',
    'delete',
    'activate',
    'deactivate',
    'feature',
    'unfeature',
    'inventory_adjust',
    'price_change',
    'login',
    'logout',
    'permission_change',
    'export',
    'import',
    'send',
    'approve',
    'reject',
  ]
  if (!body.action || !validActions.includes(body.action)) {
    return NextResponse.json({ error: `action must be one of: ${validActions.join(', ')}` }, { status: 400 })
  }
  if (!body.entity_type || typeof body.entity_type !== 'string') {
    return NextResponse.json({ error: 'entity_type required' }, { status: 400 })
  }
  if (!body.summary || typeof body.summary !== 'string') {
    return NextResponse.json({ error: 'summary required' }, { status: 400 })
  }

  await logAdminAudit({
    adminId: admin?.adminId ?? null,
    action: body.action as any,
    entityType: body.entity_type,
    entityId: body.entity_id ?? null,
    summary: body.summary,
    diff: body.diff ?? null,
    metadata: {
      ...(body.metadata ?? {}),
      ...(sa ? { service_account: sa.name } : {}),
      ...(cronOk ? { source: 'cron' } : {}),
    },
    request: req,
  })

  return NextResponse.json({ ok: true })
}
