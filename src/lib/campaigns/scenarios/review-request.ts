import { queryMany } from '@/lib/shared/db'
import { FULFILLED_SQL } from '@/lib/orders/fulfilled-status'
import { generateReviewToken } from '@/lib/auth/jwt'
import { fetchUserContext, resolveCoupon, sendCampaignEmailRendered } from '@/lib/shared/automation-emails'
import { renderCampaignEmail } from '@/lib/shared/email-campaigns'
import { apiBaseUrl } from '@/lib/shared/customer-links'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, readDurationParam } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  lookbackDays: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
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
    lookbackDays: days(30),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
    smsEnabled: false,
  },
  paramSchema: {
    lookbackDays: {
      type: 'duration',
      min: minutes(1),
      max: days(90),
      recommendedUnit: 'days',
      label: 'Lookback',
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
    smsEnabled: {
      type: 'boolean',
      label: 'Also send via SMS',
      description: "Additionally send this campaign as a text SMS when a phone number is on file (off by default)",
    },
  },

  async findEligible({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookbackDays') ?? days(30)
    return queryMany<Row>(
      `
      SELECT o.id, o.user_id, o.order_number
      FROM orders o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE ${FULFILLED_SQL}
        AND o.delivered_at < NOW() - ($2 || ' hours')::interval
        AND o.delivered_at > NOW() - ($3 || ' minutes')::interval
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
            AND ecs.channel = 'email'
            AND ecs.reference_id = o.id::text
        )
        -- review_request and review_reminder target the same orders; one review email per order.
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = 'review_reminder'
            AND ecs.channel = 'email'
            AND ecs.reference_id = o.id::text
        )
      LIMIT $4
    `,
      [campaign.kind, campaign.delay_hours, String(lookbackMin), params.maxRecipientsPerSweep]
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

    // The review page and its API live on the storefront host only (never the business portal).
    const storeBase = await apiBaseUrl()
    const itemsWithLinks = await Promise.all(
      items.map(async item => {
        const token = await generateReviewToken({ orderId: row.id, productId: item.product_id, userId: row.user_id })
        const reviewUrl = `${storeBase}/review?token=${encodeURIComponent(token)}`
        const starLinks: string[] = []
        for (let rating = 1; rating <= 5; rating++) starLinks.push(`${reviewUrl}&rating=${rating}`)
        const productUrl = item.slug ? `${user.baseUrl}/products/${encodeURIComponent(item.slug)}` : null
        return { name: item.name, imageUrl: item.image_url, starLinks, reviewUrl, productUrl, token }
      })
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    const { subject, html, ampHtml } = renderCampaignEmail(
      'review_request',
      {
        firstName: user.first_name || 'there',
        orderNumber: row.order_number,
        itemsJson: JSON.stringify(itemsWithLinks),
        couponCode: couponCode ?? '',
        discountPercent: discountPercent ? String(discountPercent) : '',
        apiBaseUrl: storeBase,
      },
      undefined,
      user.baseUrl
    )

    const emailResult = await sendCampaignEmailRendered({
      campaign,
      user,
      referenceId: row.id,
      subject,
      html,
      ampHtml,
    })
    if ((params as any).whatsappEnabled || (params as any).smsEnabled) {
      // Reuse the same token-based review link the email uses as the feedback URL.
      const feedbackUrl = itemsWithLinks[0]?.reviewUrl ?? `${user.baseUrl}/account/orders/${encodeURIComponent(row.id)}`
      sendCampaignWhatsApp(campaign.kind, row.user_id, {
        orderNumber: row.order_number,
        url: feedbackUrl,
      }).catch(() => {})
    }
    return emailResult
  },
}
