import { queryMany, queryOne } from '@/lib/shared/db'
import { ensureBuiltinCampaignRows, migrateLegacyCampaignDrafts } from '@/lib/campaigns/ensure-builtin-campaigns'

// The Campaigns list (GET /api/admin/campaigns) and its export read through this.

export async function loadCampaignList(limit: number, offset: number) {
  // Backfill a disabled campaign row for any built-in scenario missing one, so the full catalogue shows.
  await ensureBuiltinCampaignRows()
  await migrateLegacyCampaignDrafts()

  const [campaigns, countRow] = await Promise.all([
    queryMany(
      `
      SELECT
        c.*,
        (SELECT NULLIF(cd.fields, '{}'::jsonb) FROM campaign_drafts cd WHERE cd.kind = c.kind) AS draft_fields,
        (SELECT cd.campaign_id FROM campaign_drafts cd WHERE cd.kind = c.kind) AS draft_lock_id,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind), 0) AS total_sent,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.opened_at IS NOT NULL), 0) AS total_opened,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.clicked_at IS NOT NULL), 0) AS total_clicked,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.converted_at IS NOT NULL), 0) AS total_converted,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.unsubscribed_at IS NOT NULL), 0) AS total_unsubscribed,
        COALESCE((SELECT SUM(o.total_amount) FROM email_campaigns_sent ecs JOIN orders o ON o.id = ecs.conversion_order_id WHERE ecs.campaign_kind = c.kind), 0) AS revenue_attributed,
        (SELECT MAX(sent_at) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND sent_at > NOW() - INTERVAL '24 hours') AS sent_last_24h
      FROM campaigns c
      ORDER BY c.name
      LIMIT $1 OFFSET $2
    `,
      [limit, offset]
    ),
    queryOne<{ total: string }>('SELECT COUNT(*) AS total FROM campaigns'),
  ])
  return { campaigns, total: parseInt(countRow?.total || '0', 10) }
}
