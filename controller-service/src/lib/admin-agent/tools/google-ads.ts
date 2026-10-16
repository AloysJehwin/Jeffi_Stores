import { queryOne } from '@/lib/shared/db'
import { SUPER_ROLES, hasScope } from '@/lib/auth/scopes'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { getCurrentAuditAdminId } from '@/lib/auth/audit-context'
import { computeReturnMetrics, googleAdsOrderStats } from '@/lib/google-ads/attribution'
import { loadCampaigns, loadKeywords, loadOverview, loadProducts } from '@/lib/google-ads/report'
import { ActionSchema, runAction, type ManageAction } from '@/lib/google-ads/actions'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { dateInZone } from '@/lib/google-ads/sync'
import type { DateRange } from '@/lib/google-ads/queries'
import { err } from '../tool-envelope'

// Google Ads for the admin agent. Read tools answer from the synced mirror and our own orders;
// propose_* tools check the change with Google (validateOnly) and queue it for approval, which
// then runs through POST /api/admin/google-ads/manage (lib/google-ads/actions.ts: validated,
// logged in ads_change_log, google_ads_campaigns:write on Pro and up).

interface ToolInputSchema {
  type: 'object'
  properties: Record<string, { type: string; description?: string; default?: unknown; minimum?: number; maximum?: number; enum?: string[] }>
  required?: string[]
}

interface ToolDef {
  name: string
  description: string
  inputSchema: ToolInputSchema
  mutating: boolean
  handler: (input: Record<string, unknown>) => Promise<unknown>
}

export const GOOGLE_ADS_ACTION_KIND = 'google_ads_action'
/** Actions the agent may queue; anything else is refused on approval too. */
export const AGENT_ADS_ACTIONS = ['campaign.status', 'campaign.budget', 'negative.add'] as const

const READ = 'google_ads:read'
const WRITE = 'google_ads_campaigns:write'

/** Plan first, then the asking admin's own scope (tenant owners hold what their plan sells). */
export async function adsGate(scope: string): Promise<string | null> {
  const plan = await currentTenantPlanGate(scope).catch(() => ({ allowed: false, upgradeRequired: null as string | null }))
  if (!plan.allowed) {
    const need = plan.upgradeRequired ? `the ${plan.upgradeRequired.charAt(0).toUpperCase()}${plan.upgradeRequired.slice(1)} plan` : 'a higher plan'
    return scope === WRITE ? `Managing Google Ads campaigns needs ${need}.` : `Google Ads reporting needs ${need}.`
  }
  const adminId = getCurrentAuditAdminId()
  if (!adminId) return null
  const a = await queryOne<{ role: string | null; scopes: unknown }>(`SELECT role, scopes FROM admins WHERE id = $1::uuid`, [adminId]).catch(() => null)
  if (!a) return null
  const role = a.role || ''
  if ((SUPER_ROLES as readonly string[]).includes(role)) return null
  return hasScope(role, Array.isArray(a.scopes) ? (a.scopes as string[]) : [], scope)
    ? null
    : scope === WRITE
      ? 'You do not have permission to change Google Ads campaigns (Google Ads Campaigns write).'
      : 'You do not have permission to view Google Ads.'
}

const clampDays = (v: unknown, d = 30) => Math.max(1, Math.min(365, Math.floor(Number(v) || d)))

export async function rangeForDays(days: number, now = new Date()): Promise<DateRange & { tz: string }> {
  const acc = await queryOne<{ time_zone: string | null }>(`SELECT time_zone FROM ads_account WHERE id = 1`).catch(() => null)
  const tz = acc?.time_zone || 'Asia/Kolkata'
  const to = dateInZone(now, tz)
  const s = new Date(`${to}T00:00:00Z`)
  s.setUTCDate(s.getUTCDate() - (days - 1))
  return { from: s.toISOString().slice(0, 10), to, tz }
}

const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100)

/** A campaign from the mirror by id or (partial) name. */
export async function findCampaign(input: Record<string, unknown>): Promise<{ campaign_id: string; name: string; status: string | null; budget_amount_micros: string | null; channel_type: string | null } | null> {
  const id = String(input.campaignId ?? '').trim()
  const name = String(input.campaignName ?? '').trim()
  if (/^\d{1,20}$/.test(id)) {
    return queryOne(`SELECT campaign_id::text, name, status, budget_amount_micros, channel_type FROM ads_campaigns WHERE campaign_id = $1::bigint`, [id])
  }
  if (!name) return null
  return queryOne(
    `SELECT campaign_id::text, name, status, budget_amount_micros, channel_type FROM ads_campaigns
     WHERE status != 'REMOVED' AND name ILIKE '%' || $1 || '%' ORDER BY (lower(name) = lower($1)) DESC, length(name) LIMIT 1`,
    [name]
  )
}

/** Validate with Google (nothing changes) and build the approval card. */
async function propose(body: ManageAction, extra: { confirmation: string; pairs: { key: string; value: string }[] }) {
  const gate = await adsGate(WRITE)
  if (gate) return err(gate)
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid change')
  let summary: string
  try {
    const ads = await googleAdsClientFor()
    summary = (await runAction(parsed.data, ads, { adminId: getCurrentAuditAdminId(), email: null }, true)).summary
  } catch (e: any) {
    return err(`Google Ads would reject this change: ${String(e?.message ?? e).slice(0, 300)}`)
  }
  return {
    proposed: true,
    kind: GOOGLE_ADS_ACTION_KIND,
    payload: { body: parsed.data, summary },
    confirmation: extra.confirmation,
    ui_blocks: [
      { type: 'kv_pairs', pairs: [...extra.pairs, { key: 'Checked with Google', value: 'Yes (validate only, nothing changed yet)' }] },
      { type: 'callout', tone: 'info', title: 'Google Ads change', message: `${summary}. Logged under Google Ads > Change history once approved.` },
    ],
  }
}

export const GOOGLE_ADS_TOOLS: ToolDef[] = [
  {
    name: 'ads_overview',
    description:
      'Google Ads summary for the last N days: spend, clicks, conversions, Google ROAS, and true ROAS / POAS / profit after ads from our own orders, with the change vs the previous period.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', default: 30, minimum: 1, maximum: 365 } } },
    mutating: false,
    handler: async ({ days }) => {
      const gate = await adsGate(READ)
      if (gate) return err(gate)
      const range = await rangeForDays(clampDays(days))
      const o = await loadOverview(range)
      return {
        range: o.range,
        previous: o.previous,
        spend: r2(o.kpis.cost),
        previousSpend: r2(o.previousKpis.cost),
        clicks: o.kpis.clicks,
        conversions: r2(o.kpis.conversions),
        conversionValue: r2(o.kpis.conversionsValue),
        googleRoas: r2(o.kpis.roas),
        costPerConversion: r2(o.kpis.costPerConversion),
        ordersFromAds: o.orders.available ? o.orders.orders : null,
        netRevenue: o.orders.available ? o.returns.netRevenue : null,
        trueRoas: o.returns.trueRoas,
        poas: o.returns.poas,
        profitAfterAds: o.returns.profitAfterAds,
        disapprovedAds: o.disapproved,
        lastSync: o.lastSync?.finished_at ?? null,
      }
    },
  },
  {
    name: 'ads_top_campaigns',
    description: 'Google Ads campaigns for the last N days, sorted by spend (default), ROAS or conversions, with budget, status and bid strategy.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
        sort: { type: 'string', enum: ['spend', 'roas', 'conversions'], default: 'spend' },
        limit: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
      },
    },
    mutating: false,
    handler: async ({ days, sort, limit }) => {
      const gate = await adsGate(READ)
      if (gate) return err(gate)
      const rows = await loadCampaigns(await rangeForDays(clampDays(days)))
      const key = sort === 'roas' ? 'roas' : sort === 'conversions' ? 'conversions' : 'cost'
      const sorted = [...rows].sort((a: any, b: any) => (b[key] ?? 0) - (a[key] ?? 0))
      return {
        campaigns: sorted.slice(0, Math.max(1, Math.min(50, Number(limit) || 10))).map(c => ({
          campaignId: c.campaignId,
          name: c.name,
          status: c.status,
          type: c.channelType,
          dailyBudget: c.budget,
          spend: r2(c.cost),
          clicks: c.clicks,
          conversions: r2(c.conversions),
          roas: r2(c.roas),
        })),
        count: rows.length,
      }
    },
  },
  {
    name: 'ads_wasted_search_terms',
    description: 'Search terms that cost money in the last N days without a conversion, flagged when nothing in the catalogue matches. Candidates for negative keywords.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'integer', default: 30, minimum: 1, maximum: 365 }, limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 } },
    },
    mutating: false,
    handler: async ({ days, limit }) => {
      const gate = await adsGate(READ)
      if (gate) return err(gate)
      const { searchTerms } = await loadKeywords(await rangeForDays(clampDays(days)))
      const wasted = searchTerms.filter(t => t.cost > 0 && t.conversions <= 0)
      return {
        terms: wasted.slice(0, Math.max(1, Math.min(100, Number(limit) || 20))).map(t => ({
          term: t.term,
          spend: r2(t.cost),
          clicks: t.clicks,
          inCatalogue: t.inCatalogue,
          campaignId: t.campaignId,
        })),
        totalWastedSpend: r2(wasted.reduce((s, t) => s + t.cost, 0)),
      }
    },
  },
  {
    name: 'ads_products_without_stock',
    description: 'Shopping / Performance Max products that had ad spend in the last N days but are out of stock now.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', default: 14, minimum: 1, maximum: 365 } } },
    mutating: false,
    handler: async ({ days }) => {
      const gate = await adsGate(READ)
      if (gate) return err(gate)
      const { items } = await loadProducts(await rangeForDays(clampDays(days, 14)))
      const oos = items.filter(i => i.flags.includes('out_of_stock'))
      return {
        products: oos.map(i => ({ sku: i.sku, name: i.productName || i.title, spend: r2(i.cost), clicks: i.clicks, stock: i.stock, stockStatus: i.stockStatus })),
        totalSpend: r2(oos.reduce((s, i) => s + i.cost, 0)),
      }
    },
  },
  {
    name: 'ads_true_roas',
    description: 'True ROAS and POAS for Google Ads over the last N days from our own paid orders with a Google click id, net of refunds and cost prices.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', default: 30, minimum: 1, maximum: 365 } } },
    mutating: false,
    handler: async ({ days }) => {
      const gate = await adsGate(READ)
      if (gate) return err(gate)
      const range = await rangeForDays(clampDays(days))
      const [spendRow, stats] = await Promise.all([
        queryOne<{ cost: string }>(`SELECT COALESCE(SUM(cost_micros), 0) AS cost FROM ads_daily_metrics WHERE ad_group_id = 0 AND date BETWEEN $1 AND $2`, [range.from, range.to]),
        googleAdsOrderStats(range, range.tz),
      ])
      if (!stats.available) return err('Click tracking on orders is not available on this store, so true ROAS cannot be computed.')
      const spend = Number(spendRow?.cost ?? 0) / 1e6
      return { range: { from: range.from, to: range.to }, spend: r2(spend), orders: stats.orders, ...computeReturnMetrics(spend, stats) }
    },
  },
  {
    name: 'propose_pause_campaign',
    description: 'Propose pausing a Google Ads campaign (by campaignId or campaignName). Checked with Google first; the admin approves before it changes.',
    inputSchema: { type: 'object', properties: { campaignId: { type: 'string' }, campaignName: { type: 'string' } } },
    mutating: true,
    handler: async input => {
      const c = await findCampaign(input)
      if (!c) return err('Campaign not found in the synced Google Ads data.')
      if (c.status === 'PAUSED') return err(`"${c.name}" is already paused.`)
      return propose(
        { action: 'campaign.status', campaignId: c.campaign_id, status: 'PAUSED' },
        { confirmation: `Pause Google Ads campaign "${c.name}"?`, pairs: [{ key: 'Campaign', value: c.name }, { key: 'Change', value: `${c.status ?? '-'} → PAUSED` }] }
      )
    },
  },
  {
    name: 'propose_budget_change',
    description: 'Propose a new daily budget (store currency) for a Google Ads campaign (by campaignId or campaignName). Checked with Google first; the admin approves.',
    inputSchema: {
      type: 'object',
      properties: { campaignId: { type: 'string' }, campaignName: { type: 'string' }, dailyBudget: { type: 'number', minimum: 1 } },
      required: ['dailyBudget'],
    },
    mutating: true,
    handler: async input => {
      const budget = Number(input.dailyBudget)
      if (!Number.isFinite(budget) || budget < 1) return err('dailyBudget must be at least 1')
      const c = await findCampaign(input)
      if (!c) return err('Campaign not found in the synced Google Ads data.')
      const current = c.budget_amount_micros == null ? null : Number(c.budget_amount_micros) / 1e6
      return propose(
        { action: 'campaign.budget', campaignId: c.campaign_id, dailyBudget: budget },
        {
          confirmation: `Change the daily budget of "${c.name}" to ${budget}?`,
          pairs: [
            { key: 'Campaign', value: c.name },
            { key: 'Daily budget', value: `${current ?? '-'} → ${budget}` },
          ],
        }
      )
    },
  },
  {
    name: 'propose_add_negative_keyword',
    description: 'Propose adding a negative keyword to a Google Ads campaign (by campaignId or campaignName); matchType EXACT (default), PHRASE or BROAD. Checked with Google first; the admin approves.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        campaignName: { type: 'string' },
        text: { type: 'string' },
        matchType: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'], default: 'EXACT' },
      },
      required: ['text'],
    },
    mutating: true,
    handler: async input => {
      const text = String(input.text ?? '').trim()
      if (!text) return err('text is required')
      const matchType = ['EXACT', 'PHRASE', 'BROAD'].includes(String(input.matchType)) ? String(input.matchType) : 'EXACT'
      const c = await findCampaign(input)
      if (!c) return err('Campaign not found in the synced Google Ads data.')
      return propose(
        { action: 'negative.add', level: 'campaign', campaignId: c.campaign_id, text, matchType: matchType as 'EXACT' | 'PHRASE' | 'BROAD' },
        {
          confirmation: `Add negative keyword "${text}" (${matchType.toLowerCase()}) to "${c.name}"?`,
          pairs: [
            { key: 'Campaign', value: c.name },
            { key: 'Negative keyword', value: `${text} (${matchType.toLowerCase()})` },
          ],
        }
      )
    },
  },
]
