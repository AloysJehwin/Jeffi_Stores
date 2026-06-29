import { queryMany } from '@/lib/db'
import {
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
  renderItemRows,
} from '@/lib/automation-emails'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  lookbackDays: number
  maxRecipientsPerSweep: number
}

interface Row {
  id: string
  user_id: string
  order_number: string
}

export const reviewReminder: ScenarioModule<Params, Row> = {
  kind: 'review_reminder',
  name: 'Review Reminder',
  description: 'Sent N hours after delivery if no review left',
  trigger: 'Fires after delivery + the campaign\'s delay, but only if the customer hasn\'t already reviewed any product from that order. One send per order. Stops if a review is left after the email goes out.',
  defaultParams: {
    lookbackDays: 30,
    maxRecipientsPerSweep: 50,
  },
  paramSchema: {
    lookbackDays:          { type: 'integer', min: 1, max: 90,  label: 'Lookback (days)',        description: 'Only consider orders delivered in the last N days' },
    maxRecipientsPerSweep: { type: 'integer', min: 1, max: 500, label: 'Max recipients per run', description: 'Hard limit per sweep' },
  },

  async findEligible({ campaign, params }) {
    return queryMany<Row>(`
      SELECT o.id, o.user_id, o.order_number
      FROM orders o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE o.status = 'delivered'
        AND o.delivered_at < NOW() - ($2 || ' hours')::interval
        AND o.delivered_at > NOW() - ($3 || ' days')::interval
        AND u.marketing_opt_out = FALSE AND u.is_active = TRUE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM product_reviews pr
          JOIN order_items oi ON oi.product_id = pr.product_id
          WHERE oi.order_id = o.id AND pr.user_id = o.user_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.reference_id = o.id::text
        )
      LIMIT $4
    `, [campaign.kind, campaign.delay_hours, params.lookbackDays, params.maxRecipientsPerSweep])
  },

  async send(row, { campaign }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const items = await queryMany<{ name: string; product_id: string; product_slug: string | null; image_url: string | null }>(`
      SELECT oi.product_name AS name,
             oi.product_id::text AS product_id,
             p.slug AS product_slug,
             (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1::uuid
      LIMIT 8
    `, [row.id])

    const itemsHtml = renderItemRows(
      items.map(i => ({
        name: i.name,
        imageUrl: i.image_url,
        productUrl: i.product_slug ? `${user.baseUrl}/products/${i.product_slug}?review=1` : null,
      }))
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    return sendCampaignEmail({
      campaign,
      user,
      referenceId: row.id,
      vars: {
        firstName: user.first_name || 'there',
        orderNumber: row.order_number,
        itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl: `${user.baseUrl}/account/orders/${row.id}`,
      },
    })
  },
}
