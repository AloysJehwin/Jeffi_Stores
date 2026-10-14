import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryCount } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, null)
  if (admin instanceof NextResponse) return admin

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25', 10)))
  const kind = url.searchParams.get('kind') || ''
  const status = url.searchParams.get('status') || ''
  const search = url.searchParams.get('q') || ''

  const where: string[] = []
  const params: unknown[] = []
  if (kind && kind !== 'all') {
    params.push(kind)
    where.push(`kind = $${params.length}`)
  }
  if (status && status !== 'all') {
    params.push(status)
    where.push(`status = $${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    where.push(`(email ILIKE $${params.length} OR subject ILIKE $${params.length})`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  params.push(pageSize)
  params.push((page - 1) * pageSize)

  const [rows, total] = await Promise.all([
    queryMany(
      `SELECT id, email, from_email, cc, bcc, subject, template_name, kind,
              entity_type, entity_id, status, error, sent_at, message_id,
              CASE WHEN body_html IS NOT NULL THEN length(body_html) ELSE 0 END AS body_size
       FROM email_logs
       ${whereSql}
       ORDER BY sent_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    queryCount(`SELECT COUNT(*) FROM email_logs ${whereSql}`, params.slice(0, params.length - 2)),
  ])

  return NextResponse.json({ rows, total, page, pageSize })
}
