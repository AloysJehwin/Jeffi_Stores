import { getClient, queryOne } from '@/lib/db'
import {
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
  renderItemRows,
  APP_URL,
} from '@/lib/automation-emails'
import type { Campaign, CampaignKind } from '@/lib/marketing'
import type { SweepResult } from './types'
import { validateScenarioSql } from './sql-safety'

const STATEMENT_TIMEOUT_MS = 10000

interface CustomScenarioRow {
  kind: string
  generated_sql: string
  product_sql: string | null
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
    `SELECT kind, generated_sql, product_sql, enabled FROM custom_scenarios WHERE kind = $1`,
    [scenarioKind]
  )
  if (!row || !row.enabled) return result

  const validation = validateScenarioSql(row.generated_sql, 'audience')
  if (!validation.ok) return result

  let productValidation = null as ReturnType<typeof validateScenarioSql> | null
  if (row.product_sql) {
    productValidation = validateScenarioSql(row.product_sql, 'products')
    if (!productValidation.ok) productValidation = null
  }

  const params = (campaign as any).parameters || {}
  const cooldownDays = typeof params.sendCooldownDays === 'number' ? params.sendCooldownDays : 7
  const maxRecipients = typeof params.maxRecipientsPerSweep === 'number' ? params.maxRecipientsPerSweep : 50

  let userIds: string[] = []
  let products: Array<{ product_id: string; name: string; slug: string | null; image_url: string | null; price: number | null }> = []

  const client = await getClient()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`)
    await client.query(`SET LOCAL lock_timeout = '1s'`)
    const r = await client.query<{ id: string }>(validation.normalized, [campaign.kind, cooldownDays, maxRecipients])
    userIds = r.rows.map(x => x.id)

    if (productValidation && productValidation.ok) {
      try {
        const pr = await client.query<{ product_id: string; name: string; slug: string | null; image_url: string | null; price: number | null }>(productValidation.normalized)
        products = pr.rows
      } catch (err) {
        console.error('[route]', err)
        products = []
      }
    }

    await client.query('ROLLBACK')
  } catch (err) {
    console.error('[route]', err)
    try { await client.query('ROLLBACK') } catch {}
    return result
  } finally {
    client.release()
  }

  result.attempted = userIds.length

  const itemsHtml = products.length > 0
    ? renderItemRows(products.map(p => ({
        name: p.name,
        price: p.price ?? undefined,
        imageUrl: p.image_url,
        productUrl: p.slug ? `${APP_URL}/products/${p.slug}` : null,
      })))
    : ''

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
        itemsHtml,
        ctaUrl: `${APP_URL}/products`,
      },
    })
    if (r.ok) result.sent++; else result.skipped++
  }

  return result
}
