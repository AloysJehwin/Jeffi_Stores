import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  sinceSignup: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface Row {
  user_id: string
}

export const firstPurchaseNudge: ScenarioModule<Params, Row> = {
  kind: 'first_purchase_nudge',
  name: 'First Purchase Nudge',
  description: 'Signed up but has not placed a first order yet',
  trigger:
    'Fires when a customer signed up at least the configured window ago and still has no paid order. Sends at most once per cooldown window per user. Skipped for guests, inactive accounts, marketing opt-outs, and anyone who has already ordered.',
  defaultParams: {
    sinceSignup: days(3),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
    smsEnabled: false,
  },
  paramSchema: {
    sinceSignup: {
      type: 'duration',
      min: minutes(1),
      max: days(90),
      recommendedUnit: 'days',
      label: 'Time since signup',
      description: 'Only nudge users who signed up at least this long ago',
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
    const sinceSignupMin = readDurationParam(params, 'sinceSignup') ?? days(3)
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
        AND u.created_at < NOW() - ($2::text || ' minutes')::interval
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          WHERE o.user_id = u.id AND o.payment_status = 'paid'
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.channel = 'email'
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($3::text || ' minutes')::interval
        )
      LIMIT $4
    `,
      [campaign.kind, String(sinceSignupMin), String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    const sinceSignupMin = readDurationParam(params, 'sinceSignup') ?? days(3)
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      SELECT
        u.id::text AS user_id,
        CASE
          WHEN u.is_active = FALSE OR u.is_guest = TRUE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid') THEN 'other'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid') THEN 'Already placed a first order'
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN u.is_guest THEN 'Guest user'
          WHEN NOT u.is_active THEN 'Account inactive'
          WHEN ecs.sent_at IS NOT NULL THEN 'Sent ' || to_char(ecs.sent_at, 'DD Mon HH24:MI')
          ELSE NULL
        END AS reason_detail,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($3::text || ' minutes')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM users u
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = u.id
           AND channel = 'email'
           AND sent_at > NOW() - ($3::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_guest = FALSE
        AND u.created_at < NOW() - ($2::text || ' minutes')::interval
        AND (
          u.is_active = FALSE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid')
        )
      LIMIT 200
    `,
      [campaign.kind, String(sinceSignupMin), String(cooldownMin)]
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

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: {
        firstName: user.first_name || 'there',
        couponCode,
        discountPercent,
        ctaUrl: `${user.baseUrl}/products`,
      },
    })

    if (params.whatsappEnabled || (params as any).smsEnabled) {
      sendCampaignWhatsApp(
        campaign.kind,
        row.user_id,
        {
          headline: 'Welcome! Here is a little something for your first order',
          code: couponCode || '',
          discount: discountPercent ? String(discountPercent) : '',
        },
        cooldownMinutes(params)
      ).catch(() => {})
    }
    return emailResult
  },
}
