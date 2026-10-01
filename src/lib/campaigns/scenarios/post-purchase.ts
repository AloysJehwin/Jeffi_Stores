import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  lookbackDays: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  id: string
  user_id: string
  order_number: string
}

export const postPurchase: ScenarioModule<Params, Row> = {
  kind: 'post_purchase',
  name: 'Post-Purchase Thank-You',
  description: 'Sent N hours after delivery',
  trigger:
    "Fires after an order is marked delivered and at least the campaign's delay (in hours) has passed. One send per delivered order. Used for thank-you and follow-up offers.",
  defaultParams: {
    lookbackDays: 7,
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
  },
  paramSchema: {
    lookbackDays: {
      type: 'integer',
      min: 1,
      max: 30,
      label: 'Lookback (days)',
      description: 'Only consider orders delivered in the last N days',
    },
    maxRecipientsPerSweep: {
      type: 'integer',
      min: 1,
      max: 500,
      label: 'Max recipients per run',
      description: 'Hard limit per sweep',
    },
    whatsappEnabled: {
      type: 'boolean',
      label: 'Also send via WhatsApp',
      description: "Additionally send this campaign to the customer's WhatsApp when a phone number is on file",
    },
  },

  async findEligible({ campaign, params }) {
    return queryMany<Row>(
      `
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
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.reference_id = o.id::text
        )
      LIMIT $4
    `,
      [campaign.kind, campaign.delay_hours, params.lookbackDays, params.maxRecipientsPerSweep]
    )
  },

  async send(row, { campaign, params }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const items = await queryMany<{
      name: string
      quantity: number
      product_slug: string | null
      image_url: string | null
    }>(
      `
      SELECT oi.product_name AS name,
             oi.quantity::float AS quantity,
             p.slug AS product_slug,
             (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1::uuid
      LIMIT 8
    `,
      [row.id]
    )

    const itemsHtml = renderItemRows(
      items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        imageUrl: i.image_url,
        productUrl: i.product_slug ? `${user.baseUrl}/products/${i.product_slug}` : null,
      }))
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    const ctaUrl = `${user.baseUrl}/account/orders/${row.id}`
    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.id,
      vars: {
        firstName: user.first_name || 'there',
        orderNumber: row.order_number,
        itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl,
      },
    })
    if ((params as any).whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, {
        orderNumber: row.order_number,
        url: ctaUrl,
      }).catch(() => {})
    }
    return emailResult
  },
}
