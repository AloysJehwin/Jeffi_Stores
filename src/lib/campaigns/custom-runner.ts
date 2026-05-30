import { getClient, queryOne } from '@/lib/db'
import {
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
  APP_URL,
} from '@/lib/automation-emails'
import type { Campaign, CampaignKind } from '@/lib/marketing'
import type { SweepResult } from './types'
import { validateScenarioSql } from './sql-safety'

const STATEMENT_TIMEOUT_MS = 10000

interface CustomScenarioRow {
  kind: string
  generated_sql: string
  enabled: boolean
}

export async function isCustomScenario(scenarioKind: string): Promise<boolean> {
  const row = await queryOne<{ enabled: boolean }>(
    `SELECT enabled FROM custom_scenarios WHERE kind = $1`,
    [scenarioKind]
  )
  return row !== null && row.enabled === true
}

export async function runCustomScenario(scenarioKind: string, campaign: Campaign): Promise<SweepResult> {
  const result: SweepResult = { campaign: campaign.kind as CampaignKind, attempted: 0, sent: 0, skipped: 0 }

  const row = await queryOne<CustomScenarioRow>(
    `SELECT kind, generated_sql, enabled FROM custom_scenarios WHERE kind = $1`,
    [scenarioKind]
  )
  if (!row || !row.enabled) return result

  const validation = validateScenarioSql(row.generated_sql)
  if (!validation.ok) return result

  const params = (campaign as any).parameters || {}
  const cooldownDays = typeof params.sendCooldownDays === 'number' ? params.sendCooldownDays : 7
  const maxRecipients = typeof params.maxRecipientsPerSweep === 'number' ? params.maxRecipientsPerSweep : 50

  let userIds: string[] = []
  const client = await getClient()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`)
    await client.query(`SET LOCAL lock_timeout = '1s'`)
    const r = await client.query<{ id: string }>(validation.normalized, [campaign.kind, cooldownDays, maxRecipients])
    userIds = r.rows.map(x => x.id)
    await client.query('ROLLBACK')
  } catch {
    try { await client.query('ROLLBACK') } catch {}
    return result
  } finally {
    client.release()
  }

  result.attempted = userIds.length

  for (const userId of userIds) {
    const user = await fetchUserContext(userId)
    if (!user) { result.skipped++; continue }

    const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)

    const r = await sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: {
        firstName: user.first_name || 'there',
        couponCode,
        discountPercent,
        ctaUrl: `${APP_URL}/products`,
      },
    })
    if (r.ok) result.sent++; else result.skipped++
  }

  return result
}
