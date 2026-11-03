import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryOne, queryMany, refreshMirror } = vi.hoisted(() => ({ queryOne: vi.fn(), queryMany: vi.fn(), refreshMirror: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne, queryMany, query: vi.fn() }))
vi.mock('@/lib/google-ads/refresh', () => ({ refreshMirror }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn() }))

import { GoogleAdsClient } from '@/lib/google-ads/client'
import { ExperimentSpecSchema, experimentProblems, isSignificant, type ExperimentSpec } from '@/lib/google-ads/experiment-spec'
import { createExperiment, experimentAction, trialBiddingUpdate } from '@/lib/google-ads/experiments'
import { mapExperiments, mapResults, refreshExperiments, resultsQuery } from '@/lib/google-ads/experiments-read'

const CID = '1234567890'
const EXP = `customers/${CID}/experiments/700`
const TRIAL = `customers/${CID}/campaigns/902`

const spec = (over: Partial<ExperimentSpec> = {}): ExperimentSpec =>
  ExperimentSpecSchema.parse({ campaignId: '901', name: 'tROAS test', trafficSplit: 30, change: { strategy: 'MAXIMIZE_CONVERSION_VALUE', targetRoas: 4 }, ...over })

const baseRow = { campaign: { id: '901', name: 'Drills', status: 'ENABLED', advertisingChannelType: 'SEARCH', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', campaignBudget: 'b' }, campaignBudget: { amountMicros: '500000000' } }

type Handler = (url: string, body: any, method: string) => unknown
function harness(handler: Handler) {
  const calls: { url: string; body: any; method: string }[] = []
  const fetchMock = vi.fn(async (url: string, init: any) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, body, method: init.method })
    const out = handler(url, body, init.method)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out ?? {}), { status: 200 })
  })
  const client = new GoogleAdsClient({
    refreshToken: 'rt',
    customerId: CID,
    developerToken: 'dev',
    fetchImpl: fetchMock as any,
    retryDelays: [],
    getAccessToken: async () => ({ token: 'at', expiresInSec: 3600 }),
  })
  return { client, calls }
}

const searchFor = (q: string) => {
  if (q.includes('FROM campaign WHERE')) return [{ results: [baseRow] }]
  return [{ results: [] }]
}
const happy: Handler = (url, body) => {
  if (url.endsWith(':searchStream')) return searchFor(body.query)
  if (url.endsWith('/experiments:mutate')) return body.validateOnly ? {} : { results: [{ resourceName: EXP }] }
  if (url.endsWith('/experimentArms:mutate'))
    return body.validateOnly ? {} : { results: [{ resourceName: 'a1' }, { resourceName: 'a2', experimentArm: { inDesignCampaigns: [TRIAL] } }] }
  if (url.endsWith('/googleAds:mutate')) return body.validateOnly ? {} : { mutateOperationResponses: [{ campaignResult: { resourceName: TRIAL } }] }
  if (url.endsWith(':scheduleExperiment')) return { name: `customers/${CID}/operations/1` }
  return {}
}
const actor = { adminId: null, email: 'owner@store.in' }
const path = (u: string) => u.replace(/^https:\/\/googleads\.googleapis\.com\/v26/, '')

beforeEach(() => {
  queryOne.mockReset().mockResolvedValue({ id: '1' })
  queryMany.mockReset().mockResolvedValue([])
  refreshMirror.mockReset().mockResolvedValue({})
})

describe('experiment spec', () => {
  it('needs a Search/Display campaign and an actual change', () => {
    const base = { channelType: 'SEARCH', biddingStrategyType: 'MAXIMIZE_CONVERSION_VALUE', targetCpa: null, targetRoas: 4 }
    expect(experimentProblems(spec(), base, '2026-10-16')).toContain('The trial must change something: pick another bid strategy or target')
    expect(experimentProblems(spec(), { ...base, channelType: 'PERFORMANCE_MAX' }, '2026-10-16')).toContain('Experiments can be created here for Search and Display campaigns')
    expect(experimentProblems(spec({ change: { strategy: 'MAXIMIZE_CONVERSIONS', targetRoas: 3 } }), null, '2026-10-16')).toContain('Target ROAS only applies to Maximise conversion value')
    expect(experimentProblems(spec({ startDate: '2026-10-01' }), null, '2026-10-16')).toContain('The start date cannot be in the past')
    expect(experimentProblems(spec({ startDate: '2026-11-01', endDate: '2026-11-01' }), null, '2026-10-16')).toContain('The end date must be after the start date')
  })

  it('updates only the trial strategy fields', () => {
    expect(trialBiddingUpdate(TRIAL, { strategy: 'MAXIMIZE_CONVERSION_VALUE', targetRoas: 4 })).toEqual({
      update: { resourceName: TRIAL, maximizeConversionValue: { targetRoas: 4 } },
      updateMask: 'maximize_conversion_value.target_roas',
    })
    expect(trialBiddingUpdate(TRIAL, { strategy: 'MAXIMIZE_CONVERSIONS', targetCpa: 150 }).updateMask).toBe('maximize_conversions.target_cpa_micros')
    expect(trialBiddingUpdate(TRIAL, { strategy: 'MAXIMIZE_CLICKS' })).toEqual({ update: { resourceName: TRIAL, targetSpend: {} }, updateMask: 'target_spend' })
    expect(trialBiddingUpdate(TRIAL, { strategy: 'MANUAL_CPC' }).updateMask).toBe('manual_cpc')
  })
})

describe('createExperiment', () => {
  it('previews by validating the experiment only', async () => {
    const { client, calls } = harness(happy)
    expect(await createExperiment(spec(), client, actor, { preview: true })).toEqual({ preview: true })
    const writes = calls.filter(c => !c.url.endsWith(':searchStream'))
    expect(writes).toHaveLength(1)
    expect(writes[0].body).toMatchObject({ validateOnly: true, operations: [{ create: { type: 'SEARCH_CUSTOM', status: 'SETUP', suffix: ' [trial]' } }] })
  })

  it('creates the experiment, both arms, changes the trial copy and schedules, each validated first', async () => {
    const { client, calls } = harness(happy)
    const r = await createExperiment(spec(), client, actor)
    expect(r).toEqual({ experimentId: '700', trialCampaign: TRIAL, scheduled: true })
    const writes = calls.filter(c => !c.url.endsWith(':searchStream')).map(c => [path(c.url), !!c.body?.validateOnly])
    expect(writes).toEqual([
      [`/customers/${CID}/experiments:mutate`, true],
      [`/customers/${CID}/experiments:mutate`, false],
      [`/customers/${CID}/experimentArms:mutate`, true],
      [`/customers/${CID}/experimentArms:mutate`, false],
      [`/customers/${CID}/googleAds:mutate`, true],
      [`/customers/${CID}/googleAds:mutate`, false],
      [`/${EXP}:scheduleExperiment`, true],
      [`/${EXP}:scheduleExperiment`, false],
    ])
    const arms = calls.find(c => c.url.endsWith('/experimentArms:mutate') && !c.body.validateOnly)!.body
    expect(arms.responseContentType).toBe('MUTABLE_RESOURCE')
    expect(arms.operations).toEqual([
      { create: { experiment: EXP, name: 'Control', control: true, trafficSplit: 70, campaigns: [`customers/${CID}/campaigns/901`] } },
      { create: { experiment: EXP, name: 'Trial', control: false, trafficSplit: 30 } },
    ])
    const trial = calls.find(c => c.url.endsWith('/googleAds:mutate') && !c.body.validateOnly)!.body
    expect(trial.mutateOperations).toEqual([
      { campaignOperation: { update: { resourceName: TRIAL, maximizeConversionValue: { targetRoas: 4 } }, updateMask: 'maximize_conversion_value.target_roas' } },
    ])
    const logged = queryOne.mock.calls.filter(c => String(c[0]).includes('ads_change_log')).map(c => [c[1][2], c[1][7]])
    expect(logged).toEqual([
      ['experiment.create', 'applied'],
      ['experiment.trial', 'applied'],
      ['campaign.bidding', 'applied'],
      ['experiment.schedule', 'applied'],
    ])
    expect(queryOne.mock.calls.some(c => String(c[0]).includes('INSERT INTO ads_experiments'))).toBe(true)
  })

  it('removes the experiment again when scheduling is rejected', async () => {
    const { client, calls } = harness((url, body, m) =>
      url.endsWith(':scheduleExperiment')
        ? new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Experiment has no changes' } }), { status: 400 })
        : happy(url, body, m)
    )
    await expect(createExperiment(spec(), client, actor)).rejects.toMatchObject({ message: expect.stringContaining('removed again') })
    const last = calls[calls.length - 1]
    expect(last.url.endsWith('/experiments:mutate')).toBe(true)
    expect(last.body).toEqual({ operations: [{ remove: EXP }] })
  })

  it('refuses a campaign type without custom experiments before calling Google to write', async () => {
    const { client, calls } = harness((url, body, m) =>
      url.endsWith(':searchStream') && body.query.includes('FROM campaign WHERE')
        ? [{ results: [{ ...baseRow, campaign: { ...baseRow.campaign, advertisingChannelType: 'SHOPPING' } }] }]
        : happy(url, body, m)
    )
    await expect(createExperiment(spec(), client, actor)).rejects.toMatchObject({ stage: 'validate', httpStatus: 400 })
    expect(calls.every(c => c.url.endsWith(':searchStream'))).toBe(true)
  })
})

describe('end, promote, graduate', () => {
  it('ends with validateOnly then the real call', async () => {
    queryOne.mockImplementation(async (sql: string) => (String(sql).includes('FROM ads_experiments') ? { name: 'tROAS test', trial_campaign_id: '902' } : { id: '1' }))
    const { client, calls } = harness(happy)
    const r = await experimentAction('700', 'end', client, actor)
    expect(r.summary).toBe('Ended experiment "tROAS test"')
    const writes = calls.filter(c => !c.url.endsWith(':searchStream')).map(c => [path(c.url), c.body])
    expect(writes).toEqual([
      [`/${EXP}:endExperiment`, { validateOnly: true }],
      [`/${EXP}:endExperiment`, {}],
    ])
  })

  it('promotes, and preview only validates', async () => {
    const { client, calls } = harness(happy)
    expect((await experimentAction('700', 'promote', client, actor, { preview: true })).preview).toBe(true)
    expect(calls.map(c => [path(c.url), c.body])).toEqual([[`/${EXP}:promoteExperiment`, { validateOnly: true }]])
  })

  it('graduates with a new budget mapped to the trial campaign', async () => {
    queryOne.mockImplementation(async (sql: string) => (String(sql).includes('FROM ads_experiments') ? { name: 'tROAS test', trial_campaign_id: '902' } : { id: '1' }))
    const { client, calls } = harness((url, body, m) =>
      url.endsWith('/googleAds:mutate') && !body.validateOnly ? { mutateOperationResponses: [{ campaignBudgetResult: { resourceName: `customers/${CID}/campaignBudgets/5` } }] } : happy(url, body, m)
    )
    await experimentAction('700', 'graduate', client, actor, { dailyBudget: 300 })
    const grad = calls.find(c => c.url.endsWith(':graduateExperiment') && !c.body.validateOnly)!.body
    expect(grad).toEqual({ campaignBudgetMappings: [{ experimentCampaign: TRIAL, campaignBudget: `customers/${CID}/campaignBudgets/5` }] })
    await expect(experimentAction('700', 'graduate', client, actor)).rejects.toMatchObject({ stage: 'validate' })
    await expect(experimentAction('70x', 'end', client, actor)).rejects.toMatchObject({ httpStatus: 400 })
  })
})

describe('reading experiments', () => {
  const experiments = [{ experiment: { resourceName: EXP, experimentId: '700', name: 'tROAS test', type: 'SEARCH_CUSTOM', status: 'ENABLED', startDate: '2026-10-20' } }]
  const arms = [
    { experimentArm: { experiment: EXP, control: true, trafficSplit: '70', campaigns: [`customers/${CID}/campaigns/901`] } },
    { experimentArm: { experiment: EXP, control: false, trafficSplit: '30', campaigns: [TRIAL] } },
  ]
  const metrics = {
    experiment: { experimentId: '700' },
    metrics: {
      clicks: '120',
      controlClicks: '100',
      clicksPointEstimate: 18,
      clicksMarginOfError: 6,
      clicksPValue: 0.01,
      costMicros: '5000000',
      controlCostMicros: '4000000',
      costMicrosPValue: 0.4,
    },
  }

  it('maps arms and per-arm results with significance', () => {
    const [row] = mapExperiments(experiments, arms, [metrics])
    expect(row).toMatchObject({ experiment_id: '700', base_campaign_id: '901', trial_campaign_id: '902', traffic_split: 30, status: 'ENABLED' })
    const clicks = row.results!.find(r => r.key === 'clicks')!
    expect(clicks).toEqual({ key: 'clicks', label: 'Clicks', money: false, treatment: 120, control: 100, estimate: 18, margin: 6, pValue: 0.01 })
    expect(isSignificant(clicks)).toBe(true)
    const cost = mapResults(metrics).find(r => r.key === 'cost')!
    expect(cost).toMatchObject({ treatment: 5, control: 4, pValue: 0.4 })
    expect(isSignificant(cost)).toBe(false)
  })

  it('selects the documented experiment metrics, with a smaller fallback query', () => {
    expect(resultsQuery()).toContain('metrics.conversions_absolute_change_p_value')
    expect(resultsQuery(true)).not.toContain('metrics.cost_micros')
  })

  it('falls back to the core metrics when Google refuses a field, and mirrors the rows', async () => {
    const { client, calls } = harness((url, body) => {
      const q: string = body?.query ?? ''
      if (q.includes('FROM experiment_arm')) return [{ results: arms }]
      if (q.includes('metrics.cost_micros')) return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Unrecognized field' } }), { status: 400 })
      if (q.includes('metrics.')) return [{ results: [metrics] }]
      if (q.includes('FROM experiment')) return [{ results: experiments }]
      return {}
    })
    const run = vi.fn(async (_sql: string, _params?: any[]) => ({ rows: [] }))
    expect(await refreshExperiments(client, { query: run })).toBe(1)
    expect(calls.filter(c => c.body?.query?.includes('metrics.'))).toHaveLength(2)
    expect(run.mock.calls[0][1]?.slice(0, 2)).toEqual(['700', EXP])
    expect(String((run.mock.calls as any[])[1][0])).toContain('DELETE FROM ads_experiments')
  })
})
