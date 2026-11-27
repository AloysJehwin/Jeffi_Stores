import { queryMany } from '@/lib/shared/db'

// One campaign's sends, newest first (the "Recent sends" panel and its export).
export function listCampaignSends(kind: string, limit: number, offset: number) {
  return queryMany(
    `
      SELECT
        ecs.id, ecs.user_id, ecs.reference_id, ecs.sent_at, ecs.opened_at, ecs.clicked_at,
        ecs.converted_at, ecs.unsubscribed_at, ecs.bounced_at,
        u.email AS user_email,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) AS user_name,
        COALESCE(csc.send_count, 1)::integer AS send_count
      FROM email_campaigns_sent ecs
      LEFT JOIN users u ON u.id = ecs.user_id
      LEFT JOIN campaign_send_counts csc ON csc.campaign_kind = ecs.campaign_kind AND csc.user_id = ecs.user_id
      WHERE ecs.campaign_kind = $1
      ORDER BY ecs.sent_at DESC
      LIMIT $2 OFFSET $3
    `,
    [kind, limit, offset]
  )
}
