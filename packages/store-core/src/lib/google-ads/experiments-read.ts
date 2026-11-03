import { queryMany } from '@/lib/shared/db'
import { GoogleAdsApiError, type AdsRow, type GoogleAdsClient } from './client'
import type { ExperimentSpec, MetricResult } from './experiment-spec'
import { tailId } from './queries'

// Read side of campaign experiments (no mutate imports, so the sync and the report loaders stay
// light): experiments, their arms and per-arm results from Google into ads_experiments, and the
// Experiments tab data.

const METRICS: { key: string; label: string; money: boolean; t: string; c: string; est: string; moe: string; p: string }[] = [
  { key: 'clicks', label: 'Clicks', money: false, t: 'clicks', c: 'control_clicks', est: 'clicks_point_estimate', moe: 'clicks_margin_of_error', p: 'clicks_p_value' },
  {
    key: 'conversions',
    label: 'Conversions',
    money: false,
    t: 'conversions',
    c: 'control_conversions',
    est: 'conversions_absolute_change_point_estimate',
    moe: 'conversions_absolute_change_margin_of_error',
    p: 'conversions_absolute_change_p_value',
  },
  { key: 'impressions', label: 'Impressions', money: false, t: 'impressions', c: 'control_impressions', est: 'impressions_point_estimate', moe: 'impressions_margin_of_error', p: 'impressions_p_value' },
  { key: 'cost', label: 'Cost', money: true, t: 'cost_micros', c: 'control_cost_micros', est: 'cost_micros_change_point_estimate', moe: 'cost_micros_margin_of_error', p: 'cost_micros_p_value' },
  {
    key: 'value',
    label: 'Conversion value',
    money: true,
    t: 'conversions_value',
    c: 'control_conversion_value',
    est: 'conversion_value_change_point_estimate',
    moe: 'conversion_value_margin_of_error',
    p: 'conversion_value_p_value',
  },
]
/** The metrics Google's experiment reporting guide selects; the rest are tried and dropped if refused. */
const CORE = new Set(['clicks', 'conversions'])

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

export const Q_EXPERIMENTS = `SELECT experiment.resource_name, experiment.experiment_id, experiment.name, experiment.description, experiment.type,
   experiment.status, experiment.start_date, experiment.end_date, experiment.suffix, experiment.promote_status
 FROM experiment WHERE experiment.status != 'REMOVED'`

export const Q_ARMS = `SELECT experiment_arm.experiment, experiment_arm.control, experiment_arm.traffic_split, experiment_arm.campaigns,
   experiment_arm.in_design_campaigns
 FROM experiment_arm PARAMETERS include_drafts = true`

export function resultsQuery(core = false): string {
  const fields = METRICS.filter(m => !core || CORE.has(m.key)).flatMap(m => [m.t, m.c, m.est, m.moe, m.p].map(f => `metrics.${f}`))
  return `SELECT experiment.experiment_id, ${fields.join(', ')} FROM experiment WHERE experiment.status != 'REMOVED'`
}

const numOrNull = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export function mapResults(r: AdsRow): MetricResult[] {
  const m = r.metrics ?? {}
  return METRICS.filter(x => m[camel(x.t)] != null || m[camel(x.c)] != null).map(x => {
    const scale = x.money ? 1e6 : 1
    const v = (f: string) => {
      const n = numOrNull(m[camel(f)])
      return n == null ? null : n / scale
    }
    return { key: x.key, label: x.label, money: x.money, treatment: v(x.t), control: v(x.c), estimate: v(x.est), margin: v(x.moe), pValue: numOrNull(m[camel(x.p)]) }
  })
}

export interface ExperimentMirrorRow {
  experiment_id: string
  resource_name: string
  name: string
  description: string | null
  type: string | null
  status: string | null
  start_date: string | null
  end_date: string | null
  suffix: string | null
  promote_status: string | null
  base_campaign_id: string | null
  trial_campaign_id: string | null
  traffic_split: number | null
  results: MetricResult[] | null
  async_errors: string[] | null
}

export function mapExperiments(experiments: AdsRow[], arms: AdsRow[], results: AdsRow[]): ExperimentMirrorRow[] {
  const byExp = new Map<string, AdsRow[]>()
  for (const a of arms) {
    const key = String(a.experimentArm?.experiment ?? '')
    byExp.set(key, [...(byExp.get(key) ?? []), a])
  }
  const res = new Map(results.map(r => [String(r.experiment?.experimentId ?? ''), mapResults(r)]))
  return experiments
    .map(r => r.experiment ?? {})
    .filter(e => e.resourceName && e.experimentId != null)
    .map(e => {
      const list = (byExp.get(e.resourceName) ?? []).map(a => a.experimentArm)
      const control = list.find(a => a.control)
      const trial = list.find(a => !a.control)
      return {
        experiment_id: String(e.experimentId),
        resource_name: e.resourceName,
        name: e.name ?? '',
        description: e.description ?? null,
        type: e.type ?? null,
        status: e.status ?? null,
        start_date: e.startDate ?? null,
        end_date: e.endDate ?? null,
        suffix: e.suffix ?? null,
        promote_status: e.promoteStatus ?? null,
        base_campaign_id: tailId(control?.campaigns?.[0]),
        trial_campaign_id: tailId(trial?.campaigns?.[0] ?? trial?.inDesignCampaigns?.[0]),
        traffic_split: trial?.trafficSplit != null ? Number(trial.trafficSplit) : null,
        results: res.get(String(e.experimentId)) ?? null,
        async_errors: null,
      }
    })
}

/** Errors from a schedule or promote that failed after Google accepted it. */
export async function asyncErrors(ads: GoogleAdsClient, resourceName: string): Promise<string[]> {
  const res = await ads.request<{ errors?: { message?: string }[] }>('GET', `/${resourceName}:listExperimentAsyncErrors`)
  return (res?.errors ?? []).map(e => String(e?.message ?? '')).filter(Boolean).slice(0, 10)
}

/** Read every experiment from Google into ads_experiments (rows Google no longer returns go). */
export async function refreshExperiments(ads: GoogleAdsClient, db: { query: (sql: string, params?: any[]) => Promise<any> } | null = null): Promise<number> {
  const [experiments, arms] = await Promise.all([ads.searchStream(Q_EXPERIMENTS), ads.searchStream(Q_ARMS)])
  let results: AdsRow[] = []
  if (experiments.length) {
    try {
      results = await ads.searchStream(resultsQuery())
    } catch (e) {
      if (!(e instanceof GoogleAdsApiError)) throw e
      results = await ads.searchStream(resultsQuery(true)).catch(() => [])
    }
  }
  const rows = mapExperiments(experiments, arms, results)
  for (const r of rows) {
    if (r.status === 'INITIATED' || r.promote_status === 'FAILED') r.async_errors = await asyncErrors(ads, r.resource_name).catch(() => null)
  }
  const run = (sql: string, params?: any[]) => (db ? db.query(sql, params) : queryMany(sql, params))
  for (const r of rows) {
    await run(
      `INSERT INTO ads_experiments (experiment_id, resource_name, name, description, type, status, start_date, end_date, suffix,
         promote_status, base_campaign_id, trial_campaign_id, traffic_split, results, async_errors, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,now())
       ON CONFLICT (experiment_id) DO UPDATE SET resource_name=EXCLUDED.resource_name, name=EXCLUDED.name, description=EXCLUDED.description,
         type=EXCLUDED.type, status=EXCLUDED.status, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, suffix=EXCLUDED.suffix,
         promote_status=EXCLUDED.promote_status, base_campaign_id=EXCLUDED.base_campaign_id,
         trial_campaign_id=COALESCE(EXCLUDED.trial_campaign_id, ads_experiments.trial_campaign_id), traffic_split=EXCLUDED.traffic_split,
         results=COALESCE(EXCLUDED.results, ads_experiments.results), async_errors=EXCLUDED.async_errors, updated_at=now()`,
      [
        r.experiment_id, r.resource_name, r.name, r.description, r.type, r.status, r.start_date, r.end_date, r.suffix,
        r.promote_status, r.base_campaign_id, r.trial_campaign_id, r.traffic_split,
        r.results ? JSON.stringify(r.results) : null, r.async_errors ? JSON.stringify(r.async_errors) : null,
      ]
    )
  }
  await run(`DELETE FROM ads_experiments WHERE NOT (experiment_id = ANY($1::bigint[]))`, [rows.map(r => r.experiment_id)])
  return rows.length
}

export interface ExperimentView {
  experimentId: string
  name: string
  description: string | null
  type: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
  promoteStatus: string | null
  baseCampaignId: string | null
  baseCampaignName: string | null
  trialCampaignId: string | null
  trafficSplit: number | null
  change: ExperimentSpec['change'] | null
  results: MetricResult[]
  asyncErrors: string[]
  updatedAt: string | null
}

/** The Experiments tab: mirrored experiments and the campaigns a new one can be run on. */
export async function loadExperiments() {
  const [rows, campaigns] = await Promise.all([
    queryMany<any>(
      `SELECT e.*, to_char(e.start_date, 'YYYY-MM-DD') AS start_d, to_char(e.end_date, 'YYYY-MM-DD') AS end_d, c.name AS base_name
       FROM ads_experiments e LEFT JOIN ads_campaigns c ON c.campaign_id = e.base_campaign_id
       ORDER BY e.updated_at DESC, e.experiment_id DESC`
    ).catch(() => []),
    queryMany<any>(
      `SELECT campaign_id, name, channel_type, bidding_strategy_type, status FROM ads_campaigns
       WHERE channel_type IN ('SEARCH', 'DISPLAY') AND status <> 'REMOVED' AND name NOT LIKE '%[trial]%' ORDER BY name`
    ).catch(() => []),
  ])
  const experiments: ExperimentView[] = rows.map(r => ({
    experimentId: String(r.experiment_id),
    name: r.name,
    description: r.description ?? null,
    type: r.type ?? null,
    status: r.status ?? null,
    startDate: r.start_d ?? null,
    endDate: r.end_d ?? null,
    promoteStatus: r.promote_status ?? null,
    baseCampaignId: r.base_campaign_id == null ? null : String(r.base_campaign_id),
    baseCampaignName: r.base_name ?? null,
    trialCampaignId: r.trial_campaign_id == null ? null : String(r.trial_campaign_id),
    trafficSplit: r.traffic_split == null ? null : Number(r.traffic_split),
    change: r.change ?? null,
    results: Array.isArray(r.results) ? r.results : [],
    asyncErrors: Array.isArray(r.async_errors) ? r.async_errors : [],
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }))
  return {
    experiments,
    campaigns: campaigns.map(c => ({ campaignId: String(c.campaign_id), name: c.name, channelType: c.channel_type, biddingStrategy: c.bidding_strategy_type, status: c.status })),
  }
}
