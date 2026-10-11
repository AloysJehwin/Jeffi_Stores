import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  windowBefore: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
}

// The user's signup anniversary (same month+day as created_at) is coming up within `windowBefore`.
// Reuses created_at only — no DOB column needed (the birthday variant is a separate scenario).
export const signupAnniversary: ScenarioModule<Params, Row> = {
  kind: 'signup_anniversary',
  name: 'Signup Anniversary',
  description: 'Celebrate the anniversary of a customer joining',
  trigger:
    "Fires in the days leading up to the anniversary of a customer's signup (same month and day as their join date). Sends at most once per cooldown window per user. Skipped for guests, inactive accounts, and marketing opt-outs.",
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
      label: 'Reach out this far ahead',
      description: 'Send up to this long before the anniversary date',
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
    const windowMin = readDurationParam(params, 'windowBefore') ?? days(2)
    const cooldownMin = cooldownMinutes(params)

    // The next anniversary = created_at's month/day in the current year (rolled to next year if already
    // passed). Eligible when that date is between today and today + windowBefore.
    return queryMany<Row>(
      `
      SELECT u.id::text AS user_id
      FROM users u
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN make_date(EXTRACT(YEAR FROM NOW())::int, EXTRACT(MONTH FROM u.created_at)::int, LEAST(EXTRACT(DAY FROM u.created_at)::int, 28)) >= CURRENT_DATE
            THEN make_date(EXTRACT(YEAR FROM NOW())::int, EXTRACT(MONTH FROM u.created_at)::int, LEAST(EXTRACT(DAY FROM u.created_at)::int, 28))
          ELSE make_date(EXTRACT(YEAR FROM NOW())::int + 1, EXTRACT(MONTH FROM u.created_at)::int, LEAST(EXTRACT(DAY FROM u.created_at)::int, 28))
        END AS next_anniversary
      ) a
      WHERE u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND u.created_at < NOW() - INTERVAL '300 days'
        AND a.next_anniversary <= CURRENT_DATE + (($2::text || ' minutes')::interval)
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($3::text || ' minutes')::interval
        )
      LIMIT $4
    `,
      [campaign.kind, String(windowMin), String(cooldownMin), params.maxRecipientsPerSweep]
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
      SELECT
        u.id::text AS user_id,
        CASE
          WHEN u.is_active = FALSE OR u.is_guest = TRUE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN u.is_guest THEN 'Guest user'
          WHEN NOT u.is_active THEN 'Account inactive'
          WHEN ecs.sent_at IS NOT NULL THEN 'Sent ' || to_char(ecs.sent_at, 'DD Mon HH24:MI')
          ELSE NULL
        END AS reason_detail,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($2::text || ' minutes')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM users u
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = u.id
           AND sent_at > NOW() - ($2::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
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
          headline: 'Happy anniversary with us',
          code: couponCode || '',
          discount: discountPercent ? String(discountPercent) : '',
        },
        cooldownMinutes(params)
      ).catch(() => {})
    }
    return emailResult
  },
}
