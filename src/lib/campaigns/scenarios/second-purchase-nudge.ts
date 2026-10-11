import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, readDurationParam, cooldownMinutes, cooldownDays } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  sinceFirstOrder: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
}

export const secondPurchaseNudge: ScenarioModule<Params, Row> = {
  kind: 'second_purchase_nudge',
  name: 'Second Purchase Nudge',
  description: 'Placed exactly one order and has not come back',
  trigger:
    'Fires when a customer has placed exactly one paid order at least the configured window ago and has not ordered since. Sends at most once per cooldown window per user. Skipped for guests, inactive accounts, marketing opt-outs, and repeat customers.',
  defaultParams: {
    sinceFirstOrder: days(21),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
  },
  paramSchema: {
    sinceFirstOrder: {
      type: 'duration',
      min: minutes(1),
      max: days(180),
      recommendedUnit: 'days',
      label: 'Time since first order',
      description: 'Only nudge users whose single order is at least this old',
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
    const sinceMin = readDurationParam(params, 'sinceFirstOrder') ?? days(21)
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT u.id::text AS user_id
      FROM users u
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND (
          SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'
        ) = 1
        AND (
          SELECT MAX(o.created_at) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'
        ) < NOW() - ($2::text || ' minutes')::interval
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($3::text || ' minutes')::interval
        )
      LIMIT $4
    `,
      [campaign.kind, String(sinceMin), String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH one_order_users AS (
        SELECT u.id, COUNT(o.id) FILTER (WHERE o.payment_status = 'paid') AS paid_orders
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        WHERE u.is_guest = FALSE
        GROUP BY u.id
        HAVING COUNT(o.id) FILTER (WHERE o.payment_status = 'paid') >= 1
      )
      SELECT
        u.id::text AS user_id,
        CASE
          WHEN u.is_active = FALSE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN oou.paid_orders >= 2 THEN 'other'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN oou.paid_orders >= 2 THEN 'Repeat customer'
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN NOT u.is_active THEN 'Account inactive'
          WHEN ecs.sent_at IS NOT NULL THEN 'Sent ' || to_char(ecs.sent_at, 'DD Mon HH24:MI')
          ELSE NULL
        END AS reason_detail,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($2::text || ' minutes')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM one_order_users oou
      JOIN users u ON u.id = oou.id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = u.id
           AND sent_at > NOW() - ($2::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.marketing_opt_out = TRUE OR oou.paid_orders >= 2 OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, String(cooldownMin)]
    )
    return rows.map(r => ({
      user_id: r.user_id,
      reason: r.reason as any,
      reason_detail: r.reason_detail,
      blocked_until: r.blocked_until,
    }))
  },

  async send(row, { campaign, params }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const items = await queryMany<{
      name: string
      product_slug: string | null
      image_url: string | null
    }>(
      `
      SELECT DISTINCT ON (oi.product_id)
        oi.product_name AS name,
        p.slug AS product_slug,
        (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.user_id = $1::uuid AND o.payment_status = 'paid'
      ORDER BY oi.product_id, o.created_at DESC
      LIMIT 4
    `,
      [row.user_id]
    )

    const itemsHtml = renderItemRows(
      items.map(i => ({
        name: i.name,
        imageUrl: i.image_url,
        productUrl: i.product_slug ? `${user.baseUrl}/products/${i.product_slug}` : null,
      }))
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: {
        firstName: user.first_name || 'there',
        itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl: `${user.baseUrl}/products`,
      },
    })

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(
        campaign.kind,
        row.user_id,
        {
          headline: 'Come back for more',
          code: couponCode || '',
          discount: discountPercent ? String(discountPercent) : '',
        },
        cooldownDays(params)
      ).catch(() => {})
    }
    return emailResult
  },
}
