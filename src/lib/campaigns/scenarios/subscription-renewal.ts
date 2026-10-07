import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, readDurationParam, cooldownMinutes, cooldownDays } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  windowBefore: number
  sendCooldown: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  subscription_id: string
  user_id: string
  product_id: string
  product_slug: string | null
  product_name: string
  next_renewal_at: string
}

export const subscriptionRenewal: ScenarioModule<Params, Row> = {
  kind: 'subscription_renewal',
  name: 'Subscription Renewal Reminder',
  description: 'An active subscription is approaching its next renewal date',
  trigger:
    'Fires when an active subscription has its next renewal date within the configured window ahead. Sends at most once per cooldown window per user. Skipped for guests, inactive accounts, and marketing opt-outs.',
  defaultParams: {
    windowBefore: days(3),
    sendCooldown: days(14),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
  },
  paramSchema: {
    windowBefore: {
      type: 'duration',
      min: days(0),
      max: days(60),
      recommendedUnit: 'days',
      label: 'Remind before renewal',
      description: 'Send when the next renewal is within this window ahead',
    },
    sendCooldown: {
      type: 'duration',
      min: days(1),
      max: days(90),
      recommendedUnit: 'days',
      label: 'Per-user cooldown',
      description: 'Skip users sent this campaign within this window',
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
    const windowMin = readDurationParam(params, 'windowBefore') ?? days(3)
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT s.id::text AS subscription_id,
             u.id::text AS user_id,
             p.id::text AS product_id,
             p.slug AS product_slug,
             p.name AS product_name,
             s.next_renewal_at::text AS next_renewal_at
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      JOIN products p ON p.id = s.product_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE s.status = 'active'
        AND s.razorpay_subscription_id IS NULL
        AND s.next_renewal_at > NOW()
        AND s.next_renewal_at <= NOW() + ($2::text || ' minutes')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($3::text || ' minutes')::interval
        )
      ORDER BY s.next_renewal_at ASC
      LIMIT $4
    `,
      [campaign.kind, String(windowMin), String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    const windowMin = readDurationParam(params, 'windowBefore') ?? days(3)
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH subs AS (
        SELECT DISTINCT s.user_id
        FROM subscriptions s
        WHERE s.status = 'active'
          AND s.razorpay_subscription_id IS NULL
          AND s.next_renewal_at > NOW()
          AND s.next_renewal_at <= NOW() + ($2::text || ' minutes')::interval
      )
      SELECT
        sb.user_id::text,
        CASE
          WHEN u.is_active = FALSE OR u.is_guest = TRUE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN 'Sent ' || to_char(ecs.sent_at, 'DD Mon HH24:MI')
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN u.is_guest THEN 'Guest user'
          WHEN NOT u.is_active THEN 'Account inactive'
          ELSE NULL
        END AS reason_detail,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($3::text || ' minutes')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM subs sb
      JOIN users u ON u.id = sb.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = sb.user_id
           AND sent_at > NOW() - ($3::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, String(windowMin), String(cooldownMin)]
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

    const imageRows = await queryMany<{ image_url: string | null }>(
      `SELECT image_url FROM product_images WHERE product_id = $1 ORDER BY display_order ASC LIMIT 1`,
      [row.product_id]
    )
    const imageUrl = imageRows[0]?.image_url ?? null

    const itemsHtml = renderItemRows([
      {
        name: row.product_name,
        imageUrl,
        productUrl: row.product_slug ? `${user.baseUrl}/products/${row.product_slug}` : null,
      },
    ])

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.subscription_id,
      vars: {
        firstName: user.first_name || 'there',
        productName: row.product_name,
        itemsHtml,
        cartItems: itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl: row.product_slug ? `${user.baseUrl}/products/${row.product_slug}` : `${user.baseUrl}/products`,
      },
    })

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { items: row.product_name }, cooldownDays(params)).catch(() => {})
    }
    return emailResult
  },
}
