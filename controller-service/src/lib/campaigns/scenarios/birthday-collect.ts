import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { generateBirthdayToken } from '@/lib/auth/jwt'
import { days, minutes, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

interface Params extends Record<string, unknown> {
  askAgainAfter: number
  maxRecipientsPerSweep: number
}

interface Row {
  user_id: string
}

// Asking twice in a row is nagging, so this waits for the longer of its own re-ask window and
// the universal send cooldown (which defaults to one day).
function waitMinutes(params: Record<string, unknown>): number {
  return Math.max(readDurationParam(params, 'askAgainAfter') ?? days(180), cooldownMinutes(params))
}

export const birthdayCollect: ScenarioModule<Params, Row> = {
  kind: 'birthday_collect',
  name: 'Birthday Collection',
  description: 'Ask customers who have not added a birthday to share it',
  trigger:
    'Fires for retail customers with no date of birth on file. Emails a one-tap link to add their birthday without signing in, so the Birthday campaign can greet them. Asks again only after the re-ask window, and stops once a birthday is saved.',
  defaultParams: {
    askAgainAfter: days(180),
    maxRecipientsPerSweep: 100,
  },
  paramSchema: {
    askAgainAfter: {
      type: 'duration',
      min: minutes(1),
      max: days(730),
      recommendedUnit: 'days',
      label: 'Ask again after',
      description: 'Wait this long before asking a customer who did not answer again',
    },
    maxRecipientsPerSweep: {
      type: 'integer',
      min: 1,
      max: 500,
      label: 'Max recipients per run',
      description: 'Hard limit per sweep',
    },
  },

  async findEligible({ campaign, params }) {
    if (!(await getFeatureFlags()).birthdayEnabled) return []
    return queryMany<Row>(
      `
      SELECT u.id::text AS user_id
      FROM users u
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE u.date_of_birth IS NULL
        AND u.email IS NOT NULL
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.channel = 'email'
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($2::text || ' minutes')::interval
        )
      ORDER BY u.created_at ASC
      LIMIT $3
    `,
      [campaign.kind, String(waitMinutes(params)), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    if (!(await getFeatureFlags()).birthdayEnabled) return []
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
          WHEN u.is_active = FALSE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN 'Already asked for their birthday recently'
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN NOT u.is_active THEN 'Account inactive'
          ELSE NULL
        END AS reason_detail,
        CASE WHEN ecs.sent_at IS NOT NULL
          THEN (ecs.sent_at + ($2::text || ' minutes')::interval)::text
          ELSE NULL END AS blocked_until
      FROM users u
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = u.id
           AND channel = 'email'
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON ecs.sent_at > NOW() - ($2::text || ' minutes')::interval
      WHERE u.date_of_birth IS NULL
        AND u.is_guest = FALSE
        AND (u.is_active = FALSE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL)
      LIMIT 200
    `,
      [campaign.kind, String(waitMinutes(params))]
    )
    return rows.map(r => ({
      user_id: r.user_id,
      reason: r.reason as any,
      reason_detail: r.reason_detail,
      blocked_until: r.blocked_until,
    }))
  },

  async send(row, { campaign }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const token = await generateBirthdayToken(row.user_id)
    return sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: {
        firstName: user.first_name || 'there',
        ctaUrl: `${user.baseUrl}/birthday?token=${encodeURIComponent(token)}`,
      },
    })
  },
}
