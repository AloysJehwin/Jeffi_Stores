import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryCount } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (admin.role !== 'super_admin' && !hasScope(admin.role, admin.scopes, 'audit')) {
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
  if (entityType) { filterVals.push(entityType); wheres.push(`l.entity_type = $${filterVals.length}`) }
  if (action) { filterVals.push(action); wheres.push(`l.action = $${filterVals.length}`) }
  if (adminId) { filterVals.push(adminId); wheres.push(`l.admin_id = $${filterVals.length}::uuid`) }
  const whereSql = wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''

  const total = await queryCount(`SELECT COUNT(*) FROM admin_audit_log l ${whereSql}`, filterVals)

  const rowVals = [...filterVals, pageSize, offset]
  const rows = await queryMany(
    `SELECT l.id::text, l.admin_id::text, l.action, l.entity_type, l.entity_id,
            l.summary, l.diff, l.metadata, l.ip_address::text, l.created_at,
            u.first_name AS admin_first_name, u.last_name AS admin_last_name,
            a.username AS admin_username
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
