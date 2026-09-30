import { queryMany } from '@/lib/db'
import { generateReviewToken } from '@/lib/jwt'
import { fetchUserContext, resolveCoupon, sendCampaignEmailRendered } from '@/lib/automation-emails'
import { renderCampaignEmail } from '@/lib/email-campaigns'
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

export const reviewRequest: ScenarioModule<Params, Row> = {
  kind: 'review_request',
  name: 'Review Request (Email Form)',
  description: 'Sent after delivery with per-product star links that open a pre-filled review form',
  trigger: 'Fires after delivery + campaign delay, once per order, only if no review has been left yet',
  defaultParams: {
    lookbackDays: 30,
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
  },
  paramSchema: {
    lookbackDays: {
      type: 'integer',
      min: 1,
      max: 90,
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
    `,
      [campaign.kind, campaign.delay_hours, params.lookbackDays, params.maxRecipientsPerSweep]
    )
  },

  async send(row, { campaign, params }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const items = await queryMany<{ name: string; product_id: string; image_url: string | null; slug: string | null }>(
      `
      SELECT oi.product_name AS name,
             oi.product_id::text AS product_id,
             (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order ASC LIMIT 1) AS image_url,
             p.slug
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1::uuid
      LIMIT 8
    `,
      [row.id]
    )

    const itemsWithLinks = await Promise.all(
      items.map(async item => {
        const token = await generateReviewToken({ orderId: row.id, productId: item.product_id, userId: row.user_id })
        const starLinks: string[] = []
        for (let rating = 1; rating <= 5; rating++) {
          starLinks.push(`${user.baseUrl}/review?token=${token}&rating=${rating}`)
        }
        const productUrl = item.slug ? `${user.baseUrl}/products/${item.slug}` : null
        return { name: item.name, imageUrl: item.image_url, starLinks, productUrl, token }
      })
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    const { subject, html, ampHtml } = renderCampaignEmail('review_request', {
      firstName: user.first_name || 'there',
      orderNumber: row.order_number,
      itemsJson: JSON.stringify(itemsWithLinks),
      couponCode: couponCode ?? '',
      discountPercent: discountPercent ? String(discountPercent) : '',
    })

    const emailResult = await sendCampaignEmailRendered({
      campaign,
      user,
      referenceId: row.id,
      subject,
      html,
      ampHtml,
    })
    if ((params as any).whatsappEnabled) {
      // Reuse the same token-based review link the email uses as the feedback URL.
      const feedbackUrl = itemsWithLinks[0]?.token
        ? `${user.baseUrl}/review?token=${itemsWithLinks[0].token}`
        : `${user.baseUrl}/account/orders/${row.id}`
      sendCampaignWhatsApp(campaign.kind, row.user_id, {
        orderNumber: row.order_number,
        url: feedbackUrl,
      }).catch(() => {})
    }
    return emailResult
  },
}
