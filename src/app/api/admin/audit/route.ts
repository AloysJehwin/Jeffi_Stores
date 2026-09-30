import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, authenticateServiceAccount } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryCount } from '@/lib/db'
import { logAdminAudit } from '@/lib/admin-audit'

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
  const entityType = url.searchParams.get('entity_type')
  const action = url.searchParams.get('action')
  const adminId = url.searchParams.get('admin_id')

  const wheres: string[] = []
  const filterVals: any[] = []
  if (entityType) {
    filterVals.push(entityType)
    wheres.push(`l.entity_type = $${filterVals.length}`)
  }
  if (action) {
    filterVals.push(action)
    wheres.push(`l.action = $${filterVals.length}`)
  }
  if (adminId) {
    filterVals.push(adminId)
    wheres.push(`l.admin_id = $${filterVals.length}::uuid`)
  }
  const whereSql = wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''

  const total = await queryCount(`SELECT COUNT(*) FROM admin_audit_log l ${whereSql}`, filterVals)

  const rowVals = [...filterVals, pageSize, offset]
  const rows = await queryMany(
    `SELECT l.id::text, l.admin_id::text, l.action, l.entity_type, l.entity_id,
            l.summary, l.diff, l.metadata, l.ip_address::text, l.created_at,
            u.first_name AS admin_first_name, u.last_name AS admin_last_name,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS admin_username
       FROM admin_audit_log l
       LEFT JOIN admins a ON a.id = l.admin_id
       LEFT JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT $${filterVals.length + 1}
      OFFSET $${filterVals.length + 2}`,
    rowVals
  )

  return NextResponse.json({ events: rows, total, page, pageSize })
}

// POST — called by service accounts or the CRON_SECRET bearer to write audit entries.
// Auth: mTLS service account with audit:write scope, OR admin session with audit:write.
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const cronOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`

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
