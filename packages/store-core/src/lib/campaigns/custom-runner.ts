import { getClient, queryMany, queryOne } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import type { Campaign, CampaignKind } from '@/lib/shared/marketing'
import type { SweepResult } from './types'
import { validateScenarioSql } from './sql-safety'
import { cooldownDays as resolveCooldownDays } from './duration'

const STATEMENT_TIMEOUT_MS = 10000

interface CustomScenarioRow {
  kind: string
  generated_sql: string
  product_sql: string | null
  enabled: boolean
}

const ITEMS_TOKEN_RE = /\{\{?\s*itemsHtml\s*\}?\}/

export const LATEST_ORDER_ITEMS_SQL = `
  SELECT oi.product_name AS name,
         oi.quantity::float AS quantity,
         p.slug AS product_slug,
         (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order ASC LIMIT 1) AS image_url
  FROM order_items oi
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = (
    SELECT o.id FROM orders o
    WHERE o.user_id = $1 AND o.payment_status = 'paid'
    ORDER BY o.created_at DESC
    LIMIT 1
  )
  ORDER BY oi.created_at ASC NULLS LAST
  LIMIT 8
`

// Without product SQL, a template that shows {itemsHtml} means "what you ordered": the recipient's most
// recent paid order, in the same rows post_purchase uses. No order renders nothing.
async function latestOrderItemsHtml(userId: string, baseUrl: string): Promise<string> {
  const items = await queryMany<{ name: string; quantity: number; product_slug: string | null; image_url: string | null }>(
    LATEST_ORDER_ITEMS_SQL,
    [userId]
  )
  return renderItemRows(
    items.map(i => ({
      name: i.name,
      quantity: i.quantity,
      imageUrl: i.image_url,
      productUrl: i.product_slug ? `${baseUrl}/products/${encodeURIComponent(i.product_slug)}` : null,
    }))
  )
}

export async function isCustomScenario(scenarioKind: string): Promise<boolean> {
  const row = await queryOne<{ enabled: boolean }>(`SELECT enabled FROM custom_scenarios WHERE kind = $1`, [
    scenarioKind,
  ])
  return row !== null && row.enabled === true
}

export async function runCustomScenario(scenarioKind: string, campaign: Campaign): Promise<SweepResult> {
  const result: SweepResult = { campaign: campaign.kind as CampaignKind, attempted: 0, sent: 0, skipped: 0 }

  const row = await queryOne<CustomScenarioRow>(
    `SELECT kind, generated_sql, product_sql, enabled FROM custom_scenarios WHERE kind = $1`,
    [scenarioKind]
  )
  if (!row || !row.enabled) return result

  // Failures are reported on the result: the cron turns any error into a non-2xx, so a broken custom
  // campaign shows up instead of silently sending nothing forever.
  const validation = validateScenarioSql(row.generated_sql, 'audience')
  if (!validation.ok) {
    result.error = `Audience SQL rejected: ${validation.reason}`
    return result
  }

  let productValidation = null as ReturnType<typeof validateScenarioSql> | null
  if (row.product_sql) {
    productValidation = validateScenarioSql(row.product_sql, 'products')
    if (!productValidation.ok) productValidation = null
  }

  const params = (campaign as any).parameters || {}
  // Custom audience SQL binds $2 as a cooldown in DAYS (enforced by sql-safety). Resolve from the
  // canonical sendCooldown (minutes) or the legacy sendCooldownDays integer.
  const cooldownDays = resolveCooldownDays(params)
  const maxRecipients = typeof params.maxRecipientsPerSweep === 'number' ? params.maxRecipientsPerSweep : 50

  let userIds: string[] = []
  let products: Array<{
    product_id: string
    name: string
    slug: string | null
    image_url: string | null
    price: number | null
  }> = []

  const client = await getClient()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`)
    await client.query(`SET LOCAL lock_timeout = '1s'`)
    const r = await client.query<{ id: string }>(validation.normalized, [campaign.kind, cooldownDays, maxRecipients])
    userIds = r.rows.map(x => x.id)

    if (productValidation && productValidation.ok) {
      try {
        const pr = await client.query<{
          product_id: string
          name: string
          slug: string | null
          image_url: string | null
          price: number | null
        }>(productValidation.normalized)
        products = pr.rows
      } catch (err) {
        console.error('[custom-runner]', campaign.kind, 'product SQL failed', err)
        products = []
      }
    }

    await client.query('ROLLBACK')
  } catch (err) {
    console.error('[custom-runner]', campaign.kind, err)
    try {
      await client.query('ROLLBACK')
    } catch {}
    result.error = `Audience query failed: ${err instanceof Error ? err.message : String(err)}`
    return result
  } finally {
    client.release()
  }

  result.attempted = userIds.length

  // Product links follow each recipient's own base (store, or business portal), like the CTA.
  const itemsByBase = new Map<string, string>()
  const itemsHtmlFor = (baseUrl: string): string => {
    if (products.length === 0) return ''
    let html = itemsByBase.get(baseUrl)
    if (html === undefined) {
      html = renderItemRows(
        products.map(p => ({
          name: p.name,
          price: p.price ?? undefined,
          imageUrl: p.image_url,
          productUrl: p.slug ? `${baseUrl}/products/${encodeURIComponent(p.slug)}` : null,
        }))
      )
      itemsByBase.set(baseUrl, html)
    }
    return html
  }

  const orderItemsFallback =
    !row.product_sql && ITEMS_TOKEN_RE.test(`${campaign.subject_template || ''}${campaign.body_template || ''}`)

  for (const userId of userIds) {
    const user = await fetchUserContext(userId)
    if (!user) {
      result.skipped++
      continue
    }

    const { couponCode, discountPercent } = await resolveCoupon(campaign, userId)
    let itemsHtml = itemsHtmlFor(user.baseUrl)
    if (orderItemsFallback) {
      itemsHtml = await latestOrderItemsHtml(userId, user.baseUrl)
      if (!itemsHtml) console.warn('[custom-runner]', campaign.kind, 'no paid order items for {itemsHtml}', userId)
    }

    const r = await sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: {
        firstName: user.first_name || 'there',
        couponCode,
        discountPercent,
        itemsHtml,
        ctaUrl: `${user.baseUrl}/products`,
      },
    })
    if (r.ok) result.sent++
    else result.skipped++
  }

  return result
}
