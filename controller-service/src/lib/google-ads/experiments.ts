import { queryOne } from '@/lib/shared/db'
import type { GoogleAdsClient } from './client'
import { biddingFields, loadCampaignSettings } from './campaigns'
import {
  EXPERIMENT_TYPE_FOR,
  experimentProblems,
  type ExperimentAction,
  type ExperimentSpec,
} from './experiment-spec'
import { refreshExperiments } from './experiments-read'
import { AdsMutationError, explainAdsError, idFrom, logAdsChange, rn, runMutation, toMicros, type ChangeActor, type ChangeMeta } from './mutate'

// System-managed campaign experiments (ExperimentService / ExperimentArmService):
// create the experiment in SETUP, its control and trial arms (the trial gets an in-design copy of
// the campaign), change the copy's bid strategy, then schedule it. Every call is validated first
// and logged in ads_change_log; when a later step fails the experiment is removed again. Results
// per arm come from the experiment resource and are mirrored into ads_experiments.

const noRetry = (c: GoogleAdsClient) => (typeof (c as any).withRetryDelays === 'function' ? c.withRetryDelays([]) : c)

/** validateOnly, then the real call (not retried). `path` is relative to the API version root. */
async function validated<T = any>(ads: GoogleAdsClient, path: string, body: Record<string, unknown>): Promise<T> {
  try {
    await ads.request('POST', path, { ...body, validateOnly: true })
  } catch (e) {
    throw explainAdsError(e, 'validate')
  }
  try {
    return await noRetry(ads).request<T>('POST', path, body)
  } catch (e) {
    throw explainAdsError(e, 'commit')
  }
}

/** A logged step: applied or failed rows in ads_change_log. */
async function logged<T>(meta: ChangeMeta, actor: ChangeActor, fn: () => Promise<T>): Promise<T> {
  try {
    const v = await fn()
    await logAdsChange(meta, actor, 'applied', v ?? null, null)
    return v
  } catch (e) {
    const err = explainAdsError(e, 'call')
    await logAdsChange(meta, actor, err.stage === 'validate' ? 'rejected' : 'failed', null, err)
    throw err
  }
}

export const experimentRn = (cid: string, id: string) => `customers/${cid}/experiments/${id}`

/** The trial copy's bid strategy as a campaign update (fields + snake_case mask). */
export function trialBiddingUpdate(campaign: string, change: ExperimentSpec['change']): { update: Record<string, any>; updateMask: string } {
  const fields = biddingFields({ strategy: change.strategy, targetCpa: change.targetCpa, targetRoas: change.targetRoas })
  const mask =
    change.strategy === 'MAXIMIZE_CONVERSIONS'
      ? change.targetCpa
        ? 'maximize_conversions.target_cpa_micros'
        : 'maximize_conversions'
      : change.strategy === 'MAXIMIZE_CONVERSION_VALUE'
        ? change.targetRoas
          ? 'maximize_conversion_value.target_roas'
          : 'maximize_conversion_value'
        : change.strategy === 'MANUAL_CPC'
          ? 'manual_cpc'
          : 'target_spend'
  return { update: { resourceName: campaign, ...fields }, updateMask: mask }
}

const describeChange = (c: ExperimentSpec['change']) =>
  `${c.strategy.replace(/_/g, ' ').toLowerCase()}${c.targetCpa ? `, target CPA ${c.targetCpa}` : ''}${c.targetRoas ? `, target ROAS ${Math.round(c.targetRoas * 100)}%` : ''}`

async function inDesignCampaign(ads: GoogleAdsClient, experiment: string): Promise<string | null> {
  const rows = await ads.searchStream(
    `SELECT experiment_arm.control, experiment_arm.in_design_campaigns FROM experiment_arm
     WHERE experiment_arm.experiment = '${experiment}' PARAMETERS include_drafts = true`
  )
  const trial = rows.find(r => r.experimentArm && !r.experimentArm.control)
  return trial?.experimentArm?.inDesignCampaigns?.[0] ?? null
}

export interface CreateExperimentResult {
  experimentId: string
  trialCampaign: string | null
  scheduled: boolean
}

/** Create, set up and schedule a trial; preview only validates the experiment itself with Google. */
export async function createExperiment(
  spec: ExperimentSpec,
  ads: GoogleAdsClient,
  actor: ChangeActor,
  opts: { preview?: boolean } = {}
): Promise<CreateExperimentResult | { preview: true }> {
  const cid = ads.customerId
  const base = await loadCampaignSettings(ads, spec.campaignId)
  if (!base) throw new AdsMutationError('Campaign not found in Google Ads', 'validate', [], 404)
  const problems = experimentProblems(spec, base)
  if (problems.length) throw new AdsMutationError(problems[0], 'validate', problems.map(message => ({ message, code: 'INVALID' })), 400)
  if (base.portfolio) throw new AdsMutationError('This campaign uses a shared bid strategy; test it in Google Ads.', 'validate', [], 400)

  const experiment = {
    name: spec.name,
    ...(spec.description ? { description: spec.description } : {}),
    suffix: ' [trial]',
    type: EXPERIMENT_TYPE_FOR[base.channelType ?? ''],
    status: 'SETUP',
    ...(spec.startDate ? { startDate: spec.startDate } : {}),
    ...(spec.endDate ? { endDate: spec.endDate } : {}),
  }
  const meta = (action: ChangeMeta['action'], summary: string, entityId: string | null, request: Record<string, unknown> = {}): ChangeMeta => ({
    action,
    entityType: 'experiment',
    entityId,
    summary,
    request,
  })
  const path = `/customers/${cid}/experiments:mutate`
  if (opts.preview) {
    try {
      await ads.request('POST', path, { operations: [{ create: experiment }], validateOnly: true })
    } catch (e) {
      throw explainAdsError(e, 'validate')
    }
    return { preview: true }
  }

  const created = await logged(meta('experiment.create', `Created experiment "${spec.name}" on "${base.name}"`, spec.campaignId, { ...experiment }), actor, () =>
    validated<any>(ads, path, { operations: [{ create: experiment }] })
  )
  const experimentName: string = created?.results?.[0]?.resourceName ?? ''
  const experimentId = idFrom(experimentName)
  if (!experimentId) throw new AdsMutationError('Google returned no experiment id', 'commit', [], 502)

  try {
    const arms = await logged(meta('experiment.trial', `Split "${base.name}" ${100 - spec.trafficSplit}/${spec.trafficSplit} for "${spec.name}"`, experimentId), actor, () =>
      validated<any>(ads, `/customers/${cid}/experimentArms:mutate`, {
        operations: [
          { create: { experiment: experimentName, name: 'Control', control: true, trafficSplit: 100 - spec.trafficSplit, campaigns: [rn.campaign(cid, spec.campaignId)] } },
          { create: { experiment: experimentName, name: 'Trial', control: false, trafficSplit: spec.trafficSplit } },
        ],
        responseContentType: 'MUTABLE_RESOURCE',
      })
    )
    const trial: string | null = arms?.results?.[1]?.experimentArm?.inDesignCampaigns?.[0] ?? (await inDesignCampaign(ads, experimentName))
    if (!trial) throw new AdsMutationError('Google did not return the trial campaign', 'commit', [], 502)

    const upd = trialBiddingUpdate(trial, spec.change)
    await runMutation(
      {
        action: 'campaign.bidding',
        entityType: 'campaign',
        entityId: idFrom(trial),
        summary: `Trial of "${spec.name}": ${describeChange(spec.change)}`,
        operations: [{ campaignOperation: upd }],
        labels: ['Trial campaign bid strategy'],
        request: { ...spec.change },
      },
      actor,
      { client: ads }
    )
    await logged(meta('experiment.schedule', `Scheduled experiment "${spec.name}"`, experimentId), actor, () => validated(ads, `/${experimentName}:scheduleExperiment`, {}))
    await queryOne(
      `INSERT INTO ads_experiments (experiment_id, resource_name, name, type, status, base_campaign_id, trial_campaign_id, traffic_split, change, updated_at)
       VALUES ($1, $2, $3, $4, 'INITIATED', $5, $6, $7, $8::jsonb, now())
       ON CONFLICT (experiment_id) DO UPDATE SET change = EXCLUDED.change, updated_at = now()`,
      [experimentId, experimentName, spec.name, experiment.type, spec.campaignId, idFrom(trial) || null, spec.trafficSplit, JSON.stringify(spec.change)]
    ).catch(() => null)
    return { experimentId, trialCampaign: trial, scheduled: true }
  } catch (e) {
    const err = e instanceof AdsMutationError ? e : explainAdsError(e, 'commit')
    await logged(meta('experiment.remove', `Removed experiment "${spec.name}" again: ${err.message}`.slice(0, 500), experimentId), actor, () =>
      noRetry(ads).request('POST', path, { operations: [{ remove: experimentName }] })
    ).catch(() => {})
    err.message = `Google rejected a step of the experiment (${err.message}), so it was removed again.`
    throw err
  }
}

/** End (stop the trial), promote (apply the trial's changes to the base campaign) or graduate (keep the trial as its own campaign). */
export async function experimentAction(
  experimentId: string,
  action: ExperimentAction,
  ads: GoogleAdsClient,
  actor: ChangeActor,
  opts: { dailyBudget?: number; preview?: boolean } = {}
): Promise<{ ok: true; preview: boolean; summary: string }> {
  if (!/^\d+$/.test(experimentId)) throw new AdsMutationError('Invalid experiment id', 'validate', [], 400)
  const cid = ads.customerId
  const name = experimentRn(cid, experimentId)
  const row = await queryOne<{ name: string; trial_campaign_id: string | null }>(
    `SELECT name, trial_campaign_id FROM ads_experiments WHERE experiment_id = $1::bigint`,
    [experimentId]
  ).catch(() => null)
  const label = row?.name ? `"${row.name}"` : experimentId
  const meta = (summary: string, request: Record<string, unknown> = {}): ChangeMeta => ({
    action: `experiment.${action}` as ChangeMeta['action'],
    entityType: 'experiment',
    entityId: experimentId,
    summary,
    request,
  })

  if (action === 'graduate') {
    if (!opts.dailyBudget) throw new AdsMutationError('Set the daily budget the graduated campaign gets', 'validate', [], 400)
    const trial = row?.trial_campaign_id ?? (await refreshExperiments(ads).then(() => queryOne<{ t: string | null }>(
      `SELECT trial_campaign_id AS t FROM ads_experiments WHERE experiment_id = $1::bigint`, [experimentId]
    ).then(r => r?.t ?? null)))
    if (!trial) throw new AdsMutationError('The trial campaign is not known yet; refresh and try again', 'validate', [], 409)
    const summary = `Graduated experiment ${label} into its own campaign with ${opts.dailyBudget}/day`
    if (opts.preview) return { ok: true, preview: true, summary }
    const budget = await runMutation(
      {
        action: 'campaign.budget',
        entityType: 'campaign',
        entityId: String(trial),
        summary: `Budget for graduated experiment ${label}`,
        operations: [{ campaignBudgetOperation: { create: { name: `${row?.name ?? experimentId} budget ${Date.now().toString(36)}`.slice(0, 255), amountMicros: toMicros(opts.dailyBudget), deliveryMethod: 'STANDARD', explicitlyShared: false } } }],
        labels: ['Budget'],
      },
      actor,
      { client: ads }
    )
    try {
      await logged(meta(summary, { dailyBudget: opts.dailyBudget }), actor, () =>
        validated(ads, `/${name}:graduateExperiment`, {
          campaignBudgetMappings: [{ experimentCampaign: rn.campaign(cid, String(trial)), campaignBudget: budget.resourceNames[0] }],
        })
      )
    } catch (e) {
      await noRetry(ads).post('/googleAds:mutate', { mutateOperations: [{ campaignBudgetOperation: { remove: budget.resourceNames[0] } }] }).catch(() => {})
      throw e
    }
    await refreshExperiments(ads).catch(() => {})
    return { ok: true, preview: false, summary }
  }

  const method = action === 'end' ? 'endExperiment' : 'promoteExperiment'
  const summary = action === 'end' ? `Ended experiment ${label}` : `Promoted experiment ${label}: the trial's changes go to the base campaign`
  if (opts.preview) {
    try {
      await ads.request('POST', `/${name}:${method}`, { validateOnly: true })
    } catch (e) {
      throw explainAdsError(e, 'validate')
    }
    return { ok: true, preview: true, summary }
  }
  await logged(meta(summary), actor, () => validated(ads, `/${name}:${method}`, {}))
  await refreshExperiments(ads).catch(() => {})
  return { ok: true, preview: false, summary }
}


export { loadExperiments, refreshExperiments } from './experiments-read'
