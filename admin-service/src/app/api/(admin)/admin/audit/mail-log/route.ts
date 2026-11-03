import { NextRequest, NextResponse } from 'next/server'
import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { queryMany } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { EMAIL_LOG_ENTITY } from '@/lib/filters/entities/audit'
import { LOG_COUNT_CAP } from '@/lib/filters/fields/audit'
import { cappedCount } from '@/lib/filters/run'
import { listWindow } from '@/lib/filters/window'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, null)
  if (admin instanceof NextResponse) return admin

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25', 10)))

  // The list filters (old ?q= and 'all' sentinels included); without dates, the last 7 days.
  const sp = new URLSearchParams(url.searchParams)
  if (sp.get('kind') === 'all') sp.delete('kind')
  const { q, window } = listWindow(EMAIL_LOG_ENTITY, normalizeQuery(EMAIL_LOG_ENTITY, sp))
  const w = buildWhere(EMAIL_LOG_ENTITY, q)
  const params = [...w.params, pageSize, (page - 1) * pageSize]

  const [rows, counted] = await Promise.all([
    queryMany(
      `SELECT e.id, e.email, e.from_email, e.cc, e.bcc, e.subject, e.template_name, e.kind,
              e.entity_type, e.entity_id, e.status, e.error, e.sent_at, e.message_id,
              CASE WHEN e.body_html IS NOT NULL THEN length(e.body_html) ELSE 0 END AS body_size
       FROM email_logs e
       ${w.where}
       ORDER BY e.sent_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    cappedCount(EMAIL_LOG_ENTITY, q, LOG_COUNT_CAP),
  ])

  return NextResponse.json({ rows, total: counted.count, capped: counted.capped, window, page, pageSize })
}
