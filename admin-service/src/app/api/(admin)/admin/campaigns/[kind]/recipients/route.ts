import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// The customers behind one performance number on the campaign view, with the same filter as the
// stats query in ../route.ts so the list and the count always agree.
const METRICS: Record<string, { where: string; at: string }> = {
  sent: { where: 'true', at: 'ecs.sent_at' },
  opened: { where: 'ecs.opened_at IS NOT NULL', at: 'ecs.opened_at' },
  clicked: { where: 'ecs.clicked_at IS NOT NULL', at: 'ecs.clicked_at' },
  converted: { where: 'ecs.converted_at IS NOT NULL', at: 'ecs.converted_at' },
  revenue: { where: 'o.id IS NOT NULL', at: 'ecs.converted_at' },
  unsubscribed: { where: 'ecs.unsubscribed_at IS NOT NULL', at: 'ecs.unsubscribed_at' },
  push_sent: { where: `ecs.channel = 'push' AND ecs.metadata->>'status' = 'sent'`, at: 'ecs.sent_at' },
  push_waiting: { where: `ecs.channel = 'push' AND ecs.metadata->>'status' IN ('pending', 'deferred')`, at: 'ecs.sent_at' },
  push_skipped: { where: `ecs.channel = 'push' AND ecs.metadata->>'status' = 'skipped'`, at: 'ecs.sent_at' },
  push_failed: { where: `ecs.channel = 'push' AND ecs.metadata->>'status' = 'failed'`, at: 'ecs.sent_at' },
  push_opened: { where: `ecs.channel = 'push' AND ecs.opened_at IS NOT NULL`, at: 'ecs.opened_at' },
  push_converted: { where: `ecs.channel = 'push' AND ecs.converted_at IS NOT NULL`, at: 'ecs.converted_at' },
}

const PAGE = 20

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const m = METRICS[searchParams.get('metric') || '']
  if (!m) return NextResponse.json({ error: 'Unknown metric' }, { status: 400 })
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

  const from = `FROM email_campaigns_sent ecs
    LEFT JOIN users u ON u.id = ecs.user_id
    LEFT JOIN orders o ON o.id = ecs.conversion_order_id
    WHERE ecs.campaign_kind = $1 AND ${m.where}`
  const [rows, count] = await Promise.all([
    queryMany(
      `SELECT ecs.id, ecs.user_id, ecs.channel, ${m.at} AS at, ecs.metadata->>'reason' AS reason,
              u.email AS user_email, u.phone AS user_phone,
              NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS user_name,
              o.order_number, o.total_amount
       ${from}
       ORDER BY ${m.at} DESC NULLS LAST, ecs.id
       LIMIT ${PAGE} OFFSET $2`,
      [kind, offset]
    ),
    queryOne<{ n: string }>(`SELECT COUNT(*) AS n ${from}`, [kind]),
  ])
  return NextResponse.json({ rows, total: parseInt(count?.n || '0', 10), limit: PAGE, offset })
}
