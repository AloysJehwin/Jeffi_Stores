// Copy this file to add a new campaign scenario. Three steps to go live:
//   1. Copy to <your-kind>.ts, rename the export, set kind/name/description/trigger.
//   2. Register in _registry.ts (import + add to SCENARIOS).
//   3. Add the kind to CampaignKind in src/lib/shared/marketing.ts (optional; the union ends in `| string`).
// Universal params (sendCooldownDays, maxRecipientsPerSweep) are merged in by the scenarios API — do not
// redeclare them unless you need a different range. For any time window, use the `duration` param type:
// its stored value is canonical MINUTES, entered through a unit dropdown. Reach for the duration helpers.

import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { days, minutes, hours, readDurationParam } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  lookback: number // canonical minutes
  // sendCooldownDays + maxRecipientsPerSweep are universal params injected by the scenarios API;
  // read them off `params` at runtime, do not redeclare them here.
  maxRecipientsPerSweep?: number
}

interface Row {
  user_id: string
}

export const templateScenario: ScenarioModule<Params, Row> = {
  kind: 'template_scenario',
  name: 'Template Scenario',
  description: 'Describe when this campaign fires in one line',
  trigger: 'Human-readable trigger shown in the admin UI.',
  defaultParams: {
    lookback: days(14),
    maxRecipientsPerSweep: 50,
  },
  paramSchema: {
    lookback: {
      type: 'duration',
      min: minutes(1),
      max: days(90),
      recommendedUnit: 'days',
      label: 'Lookback window',
      description: 'Only consider events within this window',
    },
  },

  async findEligible({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookback') ?? days(14)
    return queryMany<Row>(
      `
      SELECT u.id::text AS user_id
      FROM users u
      WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.marketing_opt_out = FALSE
        -- your eligibility condition here, windowed with ($2::text || ' minutes')::interval
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1 AND ecs.user_id = u.id
            AND ecs.channel = 'email'
            AND ecs.sent_at > NOW() - ($3::text || ' minutes')::interval
        )
      LIMIT $4
    `,
      [campaign.kind, String(lookbackMin), String(lookbackMin), params.maxRecipientsPerSweep]
    )
  },

  async send(row, { campaign }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }
    return sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: { firstName: user.first_name || 'there', ctaUrl: `${user.baseUrl}/products` },
    })
  },
}
