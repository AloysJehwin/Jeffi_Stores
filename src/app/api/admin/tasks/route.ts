import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

const KIND_SEGMENTS: Record<string, string[]> = {
  orders:   ['process_confirmed', 'stuck_processing', 'stuck_shipment', 'ndr_check', 'address_rto', 'chase_refund', 'review_return', 'schedule_pickup', 'inspect_refund', 'process_refund', 'confirm_cod_payment', 'review_high_value_order', 'review_flagged', 'contact_failed_payment', 'abandoned_checkout'],
  support:  ['support_pickup', 'support_urgent'],
  customers:['b2b_welcome', 'collect_gst', 'vip_check_in', 'winback', 'lead_followup', 'save_customer', 'respond_review', 'followup_quote', 'chase_quote_payment'],
  security: ['login_anomaly'],
}

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const scope    = sp.get('scope')    || 'mine'
  const status   = sp.get('status')   || 'open'
  const priority = sp.get('priority') || 'all'
  const segment  = sp.get('segment')  || 'all'
  const search   = sp.get('search')   || ''
  const page     = Math.max(1, parseInt(sp.get('page') || '1', 10))

  const wheres: string[] = []
  const vals: any[] = []

  if (scope === 'mine') {
    wheres.push(`ct.assigned_to = $${vals.length + 1}`)
    vals.push(admin.adminId)
  } else if (scope === 'unassigned') {
    wheres.push(`ct.assigned_to IS NULL`)
  }

  if (status === 'open') {
    wheres.push(`ct.status IN ('pending', 'in_progress')`)
  } else if (status === 'completed') {
    wheres.push(`ct.status = 'completed' AND ct.completed_at > NOW() - INTERVAL '30 days'`)
  } else if (status === 'overdue') {
    wheres.push(`ct.status IN ('pending', 'in_progress')`)
    wheres.push(`ct.due_date < CURRENT_DATE`)
  }

  if (priority !== 'all') {
    wheres.push(`ct.priority = $${vals.length + 1}`)
    vals.push(priority)
  }

  if (segment !== 'all' && KIND_SEGMENTS[segment]) {
    const kinds = KIND_SEGMENTS[segment]
    wheres.push(`ct.source_kind = ANY($${vals.length + 1}::text[])`)
    vals.push(kinds)
  } else if (segment === 'manual') {
    wheres.push(`ct.auto_created = false`)
  }

  if (search.trim()) {
    wheres.push(`(ct.title ILIKE $${vals.length + 1} OR cu.first_name ILIKE $${vals.length + 1} OR cu.last_name ILIKE $${vals.length + 1} OR cu.email ILIKE $${vals.length + 1})`)
    vals.push(`%${search.trim()}%`)
  }

  const whereClause = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''

  const countRow = await queryOne<{ total: string }>(`
    SELECT COUNT(*) AS total
    FROM customer_tasks ct
    LEFT JOIN users cu ON ct.user_id = cu.id
    ${whereClause}
  `, vals)

  const total = parseInt(countRow?.total || '0', 10)
  const offset = (page - 1) * PAGE_SIZE

  const tasks = await queryMany(`
    SELECT
      ct.id, ct.title, ct.description, ct.due_date, ct.priority, ct.status,
      ct.completed_at, ct.created_at,
      ct.auto_created, ct.source_kind, ct.source_ref_id,
      ct.user_id,
      cu.first_name AS customer_first_name, cu.last_name AS customer_last_name, cu.email AS customer_email,
      ct.assigned_to,
      au.first_name AS assigned_first_name, au.last_name AS assigned_last_name,
      COALESCE(NULLIF(TRIM(au.first_name || ' ' || au.last_name), ''), au.email) AS assigned_username
    FROM customer_tasks ct
    LEFT JOIN users cu ON ct.user_id = cu.id
    LEFT JOIN admins a ON ct.assigned_to = a.id
    LEFT JOIN users au ON au.id = a.user_id
    ${whereClause}
    ORDER BY
      CASE WHEN ct.status = 'completed' THEN 1 ELSE 0 END,
      ct.due_date NULLS LAST,
      CASE ct.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      ct.created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, vals)

  return NextResponse.json({ tasks, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) })
}
