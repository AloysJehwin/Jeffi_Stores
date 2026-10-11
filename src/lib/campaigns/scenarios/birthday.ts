import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, fromMinutes, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

interface Params extends Record<string, unknown> {
  windowBefore: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
}

export const birthday: ScenarioModule<Params, Row> = {
  kind: 'birthday',
  name: 'Birthday',
  description: "Customer's birthday is coming up — send a greeting and a treat",
  trigger:
    "Fires when a customer's recorded date of birth falls within the window-before (counting month and day only, so it works every year). Sends a birthday greeting with the campaign coupon. One send per cooldown window per user.",
  defaultParams: {
    windowBefore: days(2),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
  },
  paramSchema: {
    windowBefore: {
      type: 'duration',
      min: days(0),
      max: days(30),
      recommendedUnit: 'days',
      label: 'Send this many days before',
      description: 'Reach out this long before the birthday',
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
    if (!(await getFeatureFlags()).birthdayEnabled) return []
    const windowMin = readDurationParam(params, 'windowBefore') ?? days(2)
    const windowDays = Math.max(0, Math.round(fromMinutes(windowMin, 'days')))
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT u.id::text AS user_id
      FROM users u
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE u.date_of_birth IS NOT NULL
        AND to_char(u.date_of_birth, 'MM-DD') = ANY (
          SELECT to_char(NOW() + (g || ' days')::interval, 'MM-DD')
          FROM generate_series(0, $2::int) AS g
        )
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
      LIMIT $4
    `,
      [campaign.kind, windowDays, String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    if (!(await getFeatureFlags()).birthdayEnabled) return []
    const windowMin = readDurationParam(params, 'windowBefore') ?? days(2)
    const windowDays = Math.max(0, Math.round(fromMinutes(windowMin, 'days')))
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
      FROM users u
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = u.id
           AND sent_at > NOW() - ($3::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.date_of_birth IS NOT NULL
        AND to_char(u.date_of_birth, 'MM-DD') = ANY (
          SELECT to_char(NOW() + (g || ' days')::interval, 'MM-DD')
          FROM generate_series(0, $2::int) AS g
        )
        AND (u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL)
      LIMIT 200
    `,
      [campaign.kind, windowDays, String(cooldownMin)]
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

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(
        campaign.kind,
        row.user_id,
        {
          headline: 'Happy birthday from all of us',
          code: couponCode || '',
          discount: discountPercent ? String(discountPercent) : '',
        },
        cooldownMinutes(params)
      ).catch(() => {})
    }
    return emailResult
  },
}
