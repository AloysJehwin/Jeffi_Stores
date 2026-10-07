import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { tierName } from '@/lib/loyalty/tiers'
import { days, readDurationParam, cooldownDays } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  recentWindow: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
  tier: string
  points: number
}

export const loyaltyTierUpgrade: ScenarioModule<Params, Row> = {
  kind: 'loyalty_tier_upgrade',
  name: 'Loyalty Tier Upgrade',
  description: 'Customer was recently promoted to a higher loyalty tier',
  trigger:
    "Fires when a customer's loyalty tier was updated within the recent window. Congratulates them on the new tier and nudges them to use their perks. Dedups once per tier so each promotion is celebrated a single time.",
  defaultParams: {
    recentWindow: days(7),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
  },
  paramSchema: {
    recentWindow: {
      type: 'duration',
      min: days(1),
      max: days(60),
      recommendedUnit: 'days',
      label: 'Recent upgrade window',
      description: 'Only consider tier changes that happened within this window',
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
    if (!(await getLoyaltySettings()).enabled) return []
    const recentMin = readDurationParam(params, 'recentWindow') ?? days(7)

    return queryMany<Row>(
      `
      SELECT la.user_id::text, la.tier, la.points::int AS points
      FROM loyalty_accounts la
      JOIN users u ON u.id = la.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE la.tier_updated_at IS NOT NULL
        AND la.tier_updated_at > NOW() - ($2::text || ' minutes')::interval
        AND la.tier <> 'bronze'
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = la.user_id
            AND ecs.reference_id = la.tier
        )
      ORDER BY la.tier_updated_at ASC
      LIMIT $3
    `,
      [campaign.kind, String(recentMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    if (!(await getLoyaltySettings()).enabled) return []
    const recentMin = readDurationParam(params, 'recentWindow') ?? days(7)

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
          WHEN ecs.sent_at IS NOT NULL THEN 'Already congratulated for ' || la.tier
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN u.is_guest THEN 'Guest user'
          WHEN NOT u.is_active THEN 'Account inactive'
          ELSE NULL
        END AS reason_detail,
        NULL::text AS blocked_until
      FROM loyalty_accounts la
      JOIN users u ON u.id = la.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = la.user_id AND reference_id = la.tier
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE la.tier_updated_at IS NOT NULL
        AND la.tier_updated_at > NOW() - ($2::text || ' minutes')::interval
        AND la.tier <> 'bronze'
        AND (u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL)
      LIMIT 200
    `,
      [campaign.kind, String(recentMin)]
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
    const tier = tierName(row.tier)

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.tier,
      vars: {
        firstName: user.first_name || 'there',
        tier,
        points: row.points,
        couponCode,
        discountPercent,
        ctaUrl: `${user.baseUrl}/account/rewards`,
      },
    })

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(
        campaign.kind,
        row.user_id,
        { headline: `You reached ${tier}!`, code: couponCode || '', discount: discountPercent ? String(discountPercent) : '' },
        cooldownDays(params)
      ).catch(() => {})
    }
    return emailResult
  },
}
