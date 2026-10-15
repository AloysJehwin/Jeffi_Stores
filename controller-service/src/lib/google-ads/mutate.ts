import { queryMany, queryOne } from '@/lib/shared/db'
import { GoogleAdsApiError, type GoogleAdsClient } from './client'
import { googleAdsClientFor } from './credentials'
import { refreshMirror, type RefreshTarget } from './refresh'

// Writes to Google Ads go through here: googleAds:mutate with validateOnly first, then the real
// call (never retried, temp-id creates are not idempotent), one ads_change_log row per attempt,
// and a targeted refresh of the mirror rows the change touched.

export type OperationKey =
  | 'campaignBudgetOperation'
  | 'campaignOperation'
  | 'campaignCriterionOperation'
  | 'adGroupOperation'
  | 'adGroupAdOperation'
  | 'adGroupCriterionOperation'
  | 'assetOperation'
  | 'campaignAssetOperation'
  | 'assetGroupOperation'
  | 'assetGroupAssetOperation'
  | 'assetGroupListingGroupFilterOperation'

export interface OpBody {
  create?: Record<string, any>
  update?: Record<string, any>
  /** snake_case field paths, comma separated. */
  updateMask?: string
  remove?: string
}

export type MutateOperation = Partial<Record<OperationKey, OpBody>>

export type AdsAction =
  | 'campaign.create'
  | 'campaign.status'
  | 'campaign.remove'
  | 'campaign.budget'
  | 'campaign.bidding'
  | 'campaign.devices'
  | 'campaign.listing_groups'
  | 'adgroup.status'
  | 'adgroup.remove'
  | 'adgroup.bid'
  | 'ad.status'
  | 'ad.remove'
  | 'keyword.status'
  | 'keyword.remove'
  | 'keyword.add'
  | 'negative.add'
  | 'assets.add'
  | 'recommendation.apply'
  | 'recommendation.dismiss'
  | 'merchant.link'

export type AdsEntity = 'campaign' | 'ad_group' | 'ad' | 'keyword' | 'asset' | 'recommendation' | 'merchant_link'

/** Negative ids for resources created in the same request (-1, -2, ...), unique across all types. */
export class TempIds {
  private last = 0
  next(): number {
    this.last -= 1
    return this.last
  }
}

/** Operations with a parallel list of labels, so a failing index reads as "Ad group Drills: keyword 3". */
export class OpList {
  readonly operations: MutateOperation[] = []
  readonly labels: string[] = []
  add(key: OperationKey, body: OpBody, label: string): this {
    this.operations.push({ [key]: body })
    this.labels.push(label)
    return this
  }
  create(key: OperationKey, resource: Record<string, any>, label: string): this {
    return this.add(key, { create: resource }, label)
  }
  /** Counts per operation type, for the preview. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const op of this.operations) {
      const k = Object.keys(op)[0]
      out[k] = (out[k] ?? 0) + 1
    }
    return out
  }
}

type Id = string | number

export const rn = {
  budget: (c: string, id: Id) => `customers/${c}/campaignBudgets/${id}`,
  campaign: (c: string, id: Id) => `customers/${c}/campaigns/${id}`,
  adGroup: (c: string, id: Id) => `customers/${c}/adGroups/${id}`,
  adGroupAd: (c: string, adGroupId: Id, adId: Id) => `customers/${c}/adGroupAds/${adGroupId}~${adId}`,
  adGroupCriterion: (c: string, adGroupId: Id, id: Id) => `customers/${c}/adGroupCriteria/${adGroupId}~${id}`,
  campaignCriterion: (c: string, campaignId: Id, id: Id) => `customers/${c}/campaignCriteria/${campaignId}~${id}`,
  asset: (c: string, id: Id) => `customers/${c}/assets/${id}`,
  assetGroup: (c: string, id: Id) => `customers/${c}/assetGroups/${id}`,
  listingFilter: (c: string, assetGroupId: Id, id: Id) => `customers/${c}/assetGroupListingGroupFilters/${assetGroupId}~${id}`,
}

/** Last id in a resource name ("customers/1/adGroupAds/22~33" -> "33"). */
export const idFrom = (name: string | null | undefined) => (name ? name.split('/').pop()!.split('~').pop()! : '')

/** Currency units to micros, rounded to the paisa: Google rejects amounts below the billable unit. */
export function toMicros(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid amount')
  return String(Math.round(amount * 100) * 10_000)
}

/** Campaign start/end in the account time zone ("yyyy-MM-dd HH:mm:ss", daily granularity). */
export const startDateTime = (d: string) => `${d} 00:00:00`
export const endDateTime = (d: string) => `${d} 23:59:59`

export function resultNames(res: any): string[] {
  return (res?.mutateOperationResponses ?? []).map((r: any) => String((Object.values(r ?? {})[0] as any)?.resourceName ?? ''))
}

export interface MutationProblem {
  message: string
  code: string
  /** Which part of the request, in words, when Google pointed at an operation. */
  where?: string
}

export class AdsMutationError extends Error {
  constructor(
    message: string,
    public stage: 'validate' | 'commit' | 'call',
    public problems: MutationProblem[],
    public httpStatus: number,
    public requestId: string | null = null
  ) {
    super(message)
    this.name = 'AdsMutationError'
  }
}

const OP_INDEX = /^mutate_operations\[(\d+)\]\.?(?:[a-z_]+_operation\.(?:create|update)\.?)?(.*)$/

/** Google's failure, with each error tied to the operation label it came from. */
export function explainAdsError(e: unknown, stage: AdsMutationError['stage'], labels: string[] = []): AdsMutationError {
  if (e instanceof AdsMutationError) return e
  if (!(e instanceof GoogleAdsApiError)) {
    const msg = String((e as any)?.message ?? e)
    return new AdsMutationError(msg, stage, [{ message: msg, code: 'ERROR' }], 500)
  }
  const problems: MutationProblem[] = e.details.length
    ? e.details.map(d => {
        const m = d.field ? OP_INDEX.exec(d.field) : null
        const label = m ? labels[Number(m[1])] : undefined
        const rest = m?.[2] ? m[2].replace(/_/g, ' ') : ''
        const where = [label, rest].filter(Boolean).join(': ') || undefined
        return { message: d.message || d.code, code: d.code, where }
      })
    : [{ message: e.message, code: e.codes[0] ?? 'ERROR' }]
  const first = problems[0]
  const message = first.where ? `${first.where}: ${first.message}` : e.message
  return new AdsMutationError(message, stage, problems, e.httpStatus, e.requestId)
}

export interface ChangeActor {
  adminId: string | null
  email?: string | null
}

export interface ChangeMeta {
  action: AdsAction
  entityType: AdsEntity
  entityId?: string | null
  summary: string
  /** Loggable request summary (never image bytes or tokens). */
  request?: Record<string, unknown>
}

export type ChangeStatus = 'applied' | 'failed' | 'rejected'

export async function logAdsChange(
  meta: ChangeMeta,
  actor: ChangeActor,
  status: ChangeStatus,
  result: unknown,
  error: AdsMutationError | null
): Promise<number | null> {
  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO ads_change_log (admin_id, admin_email, action, entity_type, entity_id, summary, request, status, result, error, google_request_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11) RETURNING id`,
      [
        actor.adminId,
        actor.email ?? null,
        meta.action,
        meta.entityType,
        meta.entityId ?? null,
        meta.summary.slice(0, 500),
        JSON.stringify(meta.request ?? {}),
        status,
        result == null ? null : JSON.stringify(result),
        error ? [error.message, ...error.problems.slice(1).map(p => (p.where ? `${p.where}: ${p.message}` : p.message))].join('\n').slice(0, 2000) : null,
        error?.requestId ?? null,
      ]
    )
    return row?.id != null ? Number(row.id) : null
  } catch (e) {
    console.error('[google-ads] change log write failed', e)
    return null
  }
}

export interface AdsChangeRow {
  id: string
  created_at: string
  admin_email: string | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  status: ChangeStatus
  error: string | null
}

export async function listAdsChanges(limit = 100): Promise<AdsChangeRow[]> {
  return queryMany<AdsChangeRow>(
    `SELECT id, created_at, admin_email, action, entity_type, entity_id, summary, status, error
     FROM ads_change_log ORDER BY created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(500, Math.floor(limit)))]
  ).catch(() => [])
}

export interface MutationPlan extends ChangeMeta {
  operations: MutateOperation[]
  /** Per-operation labels for readable errors ("Ad group Drills: keyword 3"). */
  labels?: string[]
  refresh?: RefreshTarget | ((resourceNames: string[]) => RefreshTarget)
}

export interface MutationOutcome {
  committed: boolean
  resourceNames: string[]
  logId: number | null
  refreshed: Record<string, number> | null
  refreshError: string | null
}

const noRetry = (c: GoogleAdsClient) => (typeof (c as any).withRetryDelays === 'function' ? c.withRetryDelays([]) : c)

/**
 * validateOnly, then (unless previewing) the real mutate, the change log row and the mirror refresh.
 * Throws AdsMutationError; a rejected or failed commit is logged before it is thrown.
 */
export async function runMutation(
  plan: MutationPlan,
  actor: ChangeActor,
  opts: { client?: GoogleAdsClient; preview?: boolean } = {}
): Promise<MutationOutcome> {
  if (!plan.operations.length) throw new AdsMutationError('Nothing to change', 'validate', [], 400)
  const ads = opts.client ?? (await googleAdsClientFor())
  const body = { mutateOperations: plan.operations, partialFailure: false }
  try {
    await ads.post('/googleAds:mutate', { ...body, validateOnly: true })
  } catch (e) {
    const err = explainAdsError(e, 'validate', plan.labels)
    if (!opts.preview) await logAdsChange(plan, actor, 'rejected', null, err)
    throw err
  }
  if (opts.preview) return { committed: false, resourceNames: [], logId: null, refreshed: null, refreshError: null }

  let res: any
  try {
    res = await noRetry(ads).post('/googleAds:mutate', body)
  } catch (e) {
    const err = explainAdsError(e, 'commit', plan.labels)
    await logAdsChange(plan, actor, 'failed', null, err)
    throw err
  }
  const resourceNames = resultNames(res)
  const logId = await logAdsChange(plan, actor, 'applied', { resourceNames }, null)
  let refreshed: Record<string, number> | null = null
  let refreshError: string | null = null
  if (plan.refresh) {
    try {
      const target = typeof plan.refresh === 'function' ? plan.refresh(resourceNames) : plan.refresh
      refreshed = await refreshMirror(ads, target)
    } catch (e) {
      refreshError = String((e as any)?.message ?? e).slice(0, 300)
    }
  }
  return { committed: true, resourceNames, logId, refreshed, refreshError }
}

/**
 * A logged write through a service without validateOnly (recommendations, product links). The
 * confirm dialog in the console is the preview for these.
 */
export async function runLoggedCall<T>(
  meta: ChangeMeta,
  actor: ChangeActor,
  call: () => Promise<T>,
  opts: { refresh?: (r: T) => RefreshTarget | null; client?: GoogleAdsClient; result?: (r: T) => unknown } = {}
): Promise<{ value: T; logId: number | null; refreshError: string | null }> {
  let value: T
  try {
    value = await call()
  } catch (e) {
    const err = explainAdsError(e, 'call')
    await logAdsChange(meta, actor, 'failed', null, err)
    throw err
  }
  const logId = await logAdsChange(meta, actor, 'applied', opts.result ? opts.result(value) : value, null)
  let refreshError: string | null = null
  const target = opts.refresh?.(value)
  if (target) {
    try {
      await refreshMirror(opts.client ?? (await googleAdsClientFor()), target)
    } catch (e) {
      refreshError = String((e as any)?.message ?? e).slice(0, 300)
    }
  }
  return { value, logId, refreshError }
}
