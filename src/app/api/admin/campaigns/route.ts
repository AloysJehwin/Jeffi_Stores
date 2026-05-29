import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const campaigns = await queryMany(`
    SELECT
      c.*,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind), 0) AS total_sent,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.opened_at IS NOT NULL), 0) AS total_opened,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.clicked_at IS NOT NULL), 0) AS total_clicked,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.converted_at IS NOT NULL), 0) AS total_converted,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.unsubscribed_at IS NOT NULL), 0) AS total_unsubscribed,
      COALESCE((SELECT SUM(o.total_amount) FROM email_campaigns_sent ecs JOIN orders o ON o.id = ecs.conversion_order_id WHERE ecs.campaign_kind = c.kind), 0) AS revenue_attributed,
      (SELECT MAX(sent_at) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND sent_at > NOW() - INTERVAL '24 hours') AS sent_last_24h
    FROM campaigns c
    ORDER BY c.name
  `)

  return NextResponse.json({ campaigns })
}
