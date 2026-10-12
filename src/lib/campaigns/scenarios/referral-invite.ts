import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { getOrCreateReferralCode } from '@/lib/referrals/codes'
import { getReferralSettings, isReferralLive } from '@/lib/referrals/settings'
import { days, minutes, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  sinceDelivered: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface Row {
  user_id: string
}

export const referralInvite: ScenarioModule<Params, Row> = {
  kind: 'referral_invite',
  name: 'Referral Invite',
  description: 'Happy customer with a delivered order, invited to refer a friend',
  trigger:
    "Fires for a customer whose order was delivered at least the configured delay ago and who has not yet earned a referral reward. Emails their personal referral link and the points they earn when a friend's first order arrives. Only runs while the referral program is on. One send per cooldown window per user.",
  defaultParams: {
    sinceDelivered: days(3),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
    smsEnabled: false,
  },
  paramSchema: {
    sinceDelivered: {
      type: 'duration',
      min: minutes(1),
      max: days(60),
      recommendedUnit: 'days',
      label: 'Wait after delivery',
      description: 'Wait this long after an order is delivered before inviting',
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
    if (!(await isReferralLive())) return []
    const sinceMin = readDurationParam(params, 'sinceDelivered') ?? days(3)
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT DISTINCT u.id::text AS user_id
      FROM users u
      JOIN orders o ON o.user_id = u.id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      -- delivered_at is also stamped on grant, so paid digital ('granted') orders qualify too.
      WHERE o.delivered_at IS NOT NULL
        AND o.delivered_at < NOW() - ($2::text || ' minutes')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM referral_signups rs WHERE rs.referrer_user_id = u.id AND rs.status = 'rewarded'
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
      [campaign.kind, String(sinceMin), String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    if (!(await isReferralLive())) return []
    const sinceMin = readDurationParam(params, 'sinceDelivered') ?? days(3)
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH delivered AS (
        SELECT DISTINCT u.id AS user_id
        FROM users u
        JOIN orders o ON o.user_id = u.id
        WHERE o.delivered_at IS NOT NULL
          AND o.delivered_at < NOW() - ($2::text || ' minutes')::interval
      )
      SELECT
        d.user_id::text,
        CASE
          WHEN u.is_active = FALSE OR u.is_guest = TRUE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN EXISTS (SELECT 1 FROM referral_signups rs WHERE rs.referrer_user_id = u.id AND rs.status = 'rewarded') THEN 'other'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN EXISTS (SELECT 1 FROM referral_signups rs WHERE rs.referrer_user_id = u.id AND rs.status = 'rewarded') THEN 'Already earned a referral reward'
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
      FROM delivered d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = d.user_id
           AND channel = 'email'
           AND sent_at > NOW() - ($3::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE
         OR ecs.sent_at IS NOT NULL
         OR EXISTS (SELECT 1 FROM referral_signups rs WHERE rs.referrer_user_id = u.id AND rs.status = 'rewarded')
      LIMIT 200
    `,
      [campaign.kind, String(sinceMin), String(cooldownMin)]
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

    const [code, settings] = await Promise.all([getOrCreateReferralCode(row.user_id), getReferralSettings()])
    if (!code) return { ok: false, reason: 'no_referral_code' }
    const shareUrl = `${user.baseUrl}/r/${code}`
    const rewardPoints = settings.rewardPoints

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: {
        firstName: user.first_name || 'there',
        rewardPoints,
        referralCode: code,
        shareUrl,
        ctaUrl: `${user.baseUrl}/account/referrals`,
      },
    })

    if (params.whatsappEnabled) {
      // No coupon: the promo template then sends just the headline, which carries the link.
      sendCampaignWhatsApp(
        campaign.kind,
        row.user_id,
        { headline: `Refer a friend and earn ${rewardPoints} points: ${shareUrl}`, code: '', discount: '' },
        cooldownMinutes(params)
      ).catch(() => {})
    }
    return emailResult
  },
}
