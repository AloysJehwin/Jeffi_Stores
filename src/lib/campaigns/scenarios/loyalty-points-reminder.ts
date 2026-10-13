import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { tierName } from '@/lib/loyalty/tiers'
import { cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface Row {
  user_id: string
  tier: string
  points: number
}

export const loyaltyPointsReminder: ScenarioModule<Params, Row> = {
  kind: 'loyalty_points_reminder',
  name: 'Loyalty Points Reminder',
  description: 'Customer has enough points to redeem but has not used them',
  trigger:
    "Fires when a customer's redeemable balance is at or above the minimum redemption and the program is on. Reminds them they can turn points into a coupon. Sends at most once per cooldown window per user.",
  defaultParams: {
    maxRecipientsPerSweep: 100,
    whatsappEnabled: false,
    smsEnabled: false,
  },
  paramSchema: {
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
    const settings = await getLoyaltySettings()
    if (!settings.enabled) return []
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT la.user_id::text, la.tier, la.points::int AS points
      FROM loyalty_accounts la
      JOIN users u ON u.id = la.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE la.points >= $2::int
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.channel = 'email'
            AND ecs.user_id = la.user_id
            AND ecs.sent_at > NOW() - ($3::text || ' minutes')::interval
        )
      ORDER BY la.points DESC
      LIMIT $4
    `,
      [campaign.kind, settings.minRedeemPoints, String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    const settings = await getLoyaltySettings()
    if (!settings.enabled) return []
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      SELECT
        la.user_id::text,
        CASE
          WHEN u.is_active = FALSE OR u.is_guest = TRUE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN 'Reminded within the cooldown window'
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN u.is_guest THEN 'Guest user'
          WHEN NOT u.is_active THEN 'Account inactive'
          ELSE NULL
        END AS reason_detail,
        CASE WHEN ecs.sent_at IS NOT NULL
          THEN (ecs.sent_at + ($2::text || ' minutes')::interval)::text
          ELSE NULL END AS blocked_until
      FROM loyalty_accounts la
      JOIN users u ON u.id = la.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = la.user_id
           AND channel = 'email'
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON ecs.sent_at > NOW() - ($2::text || ' minutes')::interval
      WHERE la.points >= $3::int
        AND (u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL)
      LIMIT 200
    `,
      [campaign.kind, String(cooldownMin), settings.minRedeemPoints]
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

    const settings = await getLoyaltySettings()
    const worth = Math.round(row.points * settings.pointValue)
    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)
    const tier = tierName(row.tier)

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: {
        firstName: user.first_name || 'there',
        tier,
        points: row.points,
        pointsWorth: worth,
        couponCode,
        discountPercent,
        ctaUrl: `${user.baseUrl}/account/rewards`,
      },
    })

    if (params.whatsappEnabled || (params as any).smsEnabled) {
      sendCampaignWhatsApp(
        campaign.kind,
        row.user_id,
        {
          headline: `You have ${row.points} points to spend`,
          code: couponCode || '',
          discount: discountPercent ? String(discountPercent) : '',
        },
        cooldownMinutes(params)
      ).catch(() => {})
    }
    return emailResult
  },
}
