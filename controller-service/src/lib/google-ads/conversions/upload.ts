import type { PoolClient } from 'pg'
import { getClient, queryOne } from '@/lib/shared/db'
import { GoogleAdsApiError, normalizeCustomerId, type GoogleAdsClient } from '../client'
import { googleAdsClientFromCreds, resolveGoogleAdsCreds, type GoogleAdsCreds } from '../credentials'
import { dmUserIdentifiers, userIdentifiers } from './hash'
import { sweepConversions, type Db } from './queue'
import { accountTimeZone, actionIdOf, identifiersAllowed, readConversionConfig, readTrackingSettings } from './actions'
import {
  DataManagerApiError,
  adsDestination,
  dataManagerClientFor,
  violationsByEvent,
  type AdsDestination,
  type DataManagerClient,
  type IngestEvent,
} from './data-manager'
import { pollRequestStatuses, recordRequest } from './requests'
import { afterFailure, applyUpdates, outcomeUpdate, skip, tally, type DueRow, type Update } from './rows'
import {
  ADJUST_WINDOW_DAYS,
  BATCH_SIZE,
  BLOCKING_CODES,
  CLICK_WINDOW_DAYS,
  IDENTIFIER_BLOCKERS,
  adjustmentNotBefore,
  canAdjust,
  classifyEventViolation,
  classifyRowError,
  dmAdjustmentNotBefore,
  formatAdsDateTime,
  pickClickIds,
  requestErrorMessage,
  toDate,
  type Classified,
} from './rules'
import type { UploadApi, UploadRunSummary } from './types'

export { afterFailure, type DueRow } from './rows'

// Every 30 minutes per store, under its own advisory lock (like lib/google-ads/sync.ts).
// Default: the Data Manager API. Purchases and value adjustments go through events:ingest; Google's
// verdict per request is read back with requestStatus:retrieve. Per-store fallback: the Google Ads
// API (uploadClickConversions / uploadConversionAdjustments with partialFailure), which Google only
// serves to developer tokens that uploaded offline conversions before 15 June 2026.

export const ADS_CONVERSIONS_LOCK_KEY = 84219593
const DAY = 86_400_000
/** Fast-fail rounds per batch: each drops the events Google named and sends the rest again. */
const MAX_PASSES = 3

export class ConversionUploadInProgressError extends Error {
  constructor() {
    super('A conversion upload is already running. Try again when it finishes.')
    this.name = 'ConversionUploadInProgressError'
  }
}

// ---- Google Ads API payloads (fallback) ----

export function buildClickConversion(r: DueRow, o: { action: string; timeZone: string; identifiers: boolean }) {
  const ids = o.identifiers && r.ads_consent === true ? userIdentifiers(r.customer_email, r.customer_phone) : []
  return {
    conversionAction: o.action,
    conversionDateTime: formatAdsDateTime(toDate(r.conversion_at) ?? new Date(), o.timeZone),
    conversionValue: Number(r.value),
    currencyCode: r.currency_code || 'INR',
    orderId: r.order_number,
    ...pickClickIds(r),
    // No cookie choice recorded: unspecified, so the account's default applies.
    ...(r.ads_consent == null ? {} : { consent: { adUserData: r.ads_consent ? 'GRANTED' : 'DENIED' } }),
    ...(ids.length ? { userIdentifiers: ids } : {}),
  }
}

export function buildAdjustment(r: DueRow, o: { action: string; timeZone: string }) {
  return {
    conversionAction: o.action,
    adjustmentType: r.kind === 'retraction' ? 'RETRACTION' : 'RESTATEMENT',
    orderId: r.order_number,
    adjustmentDateTime: formatAdsDateTime(toDate(r.adjustment_at) ?? new Date(), o.timeZone),
    ...(r.kind === 'restatement'
      ? { restatementValue: { adjustedValue: Number(r.value), currencyCode: r.currency_code || 'INR' } }
      : {}),
  }
}

// ---- Data Manager API payloads ----

const rfc3339 = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Cookie choice as Data Manager consent; none recorded leaves it to the account's defaults. */
export function consentFor(adsConsent: boolean | null | undefined): IngestEvent['consent'] | null {
  if (adsConsent === true) return { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' }
  if (adsConsent === false) return { adUserData: 'CONSENT_DENIED', adPersonalization: 'CONSENT_DENIED' }
  return null
}

/** One purchase. Hashed email / phone only for buyers who accepted ad cookies, with enhanced conversions on. */
export function buildPurchaseEvent(r: DueRow, identifiers: boolean): IngestEvent {
  const consent = consentFor(r.ads_consent)
  const ids = identifiers && r.ads_consent === true ? dmUserIdentifiers(r.customer_email, r.customer_phone) : []
  return {
    transactionId: r.order_number,
    eventTimestamp: rfc3339(toDate(r.conversion_at) ?? new Date()),
    eventSource: 'WEB',
    conversionValue: Number(r.value),
    currency: r.currency_code || 'INR',
    adIdentifiers: pickClickIds(r) as IngestEvent['adIdentifiers'],
    ...(consent ? { consent } : {}),
    ...(ids.length ? { userData: { userIdentifiers: ids } } : {}),
  }
}

/**
 * The purchase again with the new value: same transaction id, time and click, so Google treats it
 * as an adjustment and overwrites the value. A retraction is a value of 0 (the count stays).
 */
export function buildAdjustmentEvent(
  r: DueRow,
  purchase: Pick<DueRow, 'conversion_at' | 'gclid' | 'gbraid' | 'wbraid'>,
  identifiers: boolean,
  now: Date
): IngestEvent {
  return {
    ...buildPurchaseEvent(
      {
        ...r,
        conversion_at: purchase.conversion_at,
        gclid: purchase.gclid,
        gbraid: purchase.gbraid,
        wbraid: purchase.wbraid,
        value: r.kind === 'retraction' ? 0 : r.value,
      },
      identifiers
    ),
    lastUpdatedTimestamp: rfc3339(toDate(r.adjustment_at) ?? now),
  }
}

export interface RowResult {
  ok: boolean
  code: string
  message: string
}

/** Per-row outcome of a partial-failure upload; errors find their row via location.fieldPathElements. */
export function mapPartialFailure(res: any, count: number, field: 'conversions' | 'conversion_adjustments'): RowResult[] {
  const names = new Set([field, field === 'conversions' ? 'conversions' : 'conversionAdjustments'])
  const errs = new Map<number, { code: string; message: string }>()
  const pf = res?.partialFailureError
  for (const d of pf?.details ?? []) {
    if (!String(d?.['@type'] ?? '').includes('GoogleAdsFailure')) continue
    for (const e of d.errors ?? []) {
      const el = (e?.location?.fieldPathElements ?? []).find((p: any) => names.has(p?.fieldName))
      const idx = el ? Number(el.index ?? 0) : count === 1 ? 0 : -1
      if (!(idx >= 0 && idx < count) || errs.has(idx)) continue
      errs.set(idx, { code: String(Object.values(e?.errorCode ?? {})[0] ?? 'UNKNOWN'), message: String(e?.message ?? '') })
    }
  }
  const results: any[] = Array.isArray(res?.results) ? res.results : []
  return Array.from({ length: count }, (_, i) => {
    const err = errs.get(i)
    if (err) return { ok: false, ...err }
    const empty = !results[i] || Object.keys(results[i]).length === 0
    if (pf && empty) return { ok: false, code: '', message: String(pf.message || 'Google did not accept this row') }
    return { ok: true, code: '', message: '' }
  })
}

interface RunCtx {
  db: Db
  ads: GoogleAdsClient
  action: string
  timeZone: string
  identifiers: boolean
  now: Date
  jobId: number
  run: UploadRunSummary
}

interface DmCtx {
  db: Db
  dm: DataManagerClient
  action: string
  /** The destination for a conversion action (purchases: the chosen one; adjustments: their purchase's). */
  destinationFor: (action: string) => AdsDestination
  identifiers: boolean
  now: Date
  run: UploadRunSummary
  /** Set once a setup / auth problem stops the run; the rest of the queue waits. */
  blocked: DataManagerApiError | null
}

const uploaded = (row: DueRow, value: number | null, action: string, ids: { jobId?: string | null; requestId?: string | null }): Update => ({
  id: row.id,
  status: 'uploaded',
  inc: 1,
  code: null,
  error: null,
  nextAt: null,
  value,
  action,
  jobId: ids.jobId ?? null,
  requestId: ids.requestId ?? null,
})

/** Restatements queued before the purchase went out were sent as its value. */
function foldedUpdates(updates: Update[], foldsById: Map<number, number[]>): Update[] {
  return updates
    .filter(u => u.status === 'uploaded')
    .flatMap(u => foldsById.get(u.id) ?? [])
    .map(id => skip(id, 'FOLDED', 'Sent as part of the purchase upload.'))
}

interface PurchaseBatch {
  send: DueRow[]
  values: number[]
  foldsById: Map<number, number[]>
}

/** Purchases due now. A retraction already queued means nothing is sent; a queued restatement's value is sent instead. */
async function duePurchases(db: Db, now: Date, run: UploadRunSummary): Promise<PurchaseBatch | null> {
  const due = (
    await db.query(
      `SELECT u.*, o.customer_email, o.customer_phone, o.ads_consent
       FROM ads_conversion_uploads u LEFT JOIN orders o ON o.id = u.order_id
       WHERE u.status = 'pending' AND u.kind = 'purchase' AND u.next_attempt_at <= $1
       ORDER BY u.created_at LIMIT ${BATCH_SIZE}`,
      [now]
    )
  ).rows as DueRow[]
  if (!due.length) return null
  const siblings = new Map<string, DueRow[]>()
  for (const s of (
    await db.query(
      `SELECT id, order_id, kind, version, value, status FROM ads_conversion_uploads
       WHERE kind <> 'purchase' AND order_id = ANY($1::uuid[])`,
      [due.map(r => r.order_id)]
    )
  ).rows as DueRow[]) {
    siblings.set(s.order_id, [...(siblings.get(s.order_id) ?? []), s])
  }

  const pre: Update[] = []
  const send: DueRow[] = []
  const values: number[] = []
  const foldsById = new Map<number, number[]>()
  for (const r of due) {
    const sib = siblings.get(r.order_id) ?? []
    const pendingSib = sib.filter(s => s.status === 'pending')
    if (sib.some(s => s.kind === 'retraction')) {
      const why = 'The order was cancelled or refunded before the purchase was uploaded, so nothing was sent.'
      pre.push(skip(r.id, 'CANCELLED_BEFORE_UPLOAD', why), ...pendingSib.map(s => skip(s.id, 'CANCELLED_BEFORE_UPLOAD', why)))
      continue
    }
    const restated = sib.filter(s => s.kind === 'restatement').sort((a, b) => a.version - b.version)
    send.push(r)
    values.push(Number((restated[restated.length - 1] ?? r).value))
    foldsById.set(r.id, pendingSib.map(s => s.id))
  }
  await applyUpdates(db, pre, now)
  tally(run, pre)
  return send.length ? { send, values, foldsById } : null
}

interface AdjustTarget {
  row: DueRow
  purchase: DueRow
}

/** Retractions / restatements due now: one per order, once its purchase is uploaded and old enough. */
async function dueAdjustments(db: Db, now: Date, run: UploadRunSummary, api: UploadApi): Promise<AdjustTarget[]> {
  const due = (
    await db.query(
      `SELECT u.*, o.customer_email, o.customer_phone, o.ads_consent
       FROM ads_conversion_uploads u LEFT JOIN orders o ON o.id = u.order_id
       WHERE u.status = 'pending' AND u.kind <> 'purchase' AND u.next_attempt_at <= $1
       ORDER BY u.created_at LIMIT ${BATCH_SIZE}`,
      [now]
    )
  ).rows as DueRow[]
  if (!due.length) return []
  const purchases = new Map<string, DueRow>()
  for (const p of (
    await db.query(
      `SELECT p.id, p.order_id, p.status, p.conversion_at, p.uploaded_at, p.gclid, p.gbraid, p.wbraid,
              p.conversion_action, p.request_id, r.status AS request_status
       FROM ads_conversion_uploads p LEFT JOIN ads_conversion_requests r ON r.request_id = p.request_id
       WHERE p.kind = 'purchase' AND p.order_id = ANY($1::uuid[])`,
      [[...new Set(due.map(r => r.order_id))]]
    )
  ).rows as DueRow[]) {
    purchases.set(p.order_id, p)
  }

  const groups = new Map<string, DueRow[]>()
  for (const r of due) groups.set(r.order_id, [...(groups.get(r.order_id) ?? []), r])

  const pre: Update[] = []
  const targets: AdjustTarget[] = []
  for (const [orderId, rows] of groups) {
    const p = purchases.get(orderId)
    if (p?.status === 'pending') continue
    if (!p || p.status !== 'uploaded') {
      pre.push(...rows.map(r => skip(r.id, 'NOT_UPLOADED', 'The purchase was not uploaded to Google, so there is nothing to adjust.')))
      continue
    }
    if (api === 'ads_api' && !canAdjust(p)) {
      pre.push(...rows.map(r => skip(r.id, 'WBRAID', 'The Google Ads API does not take adjustments for wbraid (iOS) conversions.')))
      continue
    }
    const target = rows.find(r => r.kind === 'retraction') ?? [...rows].sort((a, b) => a.version - b.version)[rows.length - 1]
    const why = target.kind === 'retraction' ? 'Replaced by the retraction.' : 'Replaced by a newer value.'
    pre.push(...rows.filter(r => r !== target).map(r => skip(r.id, 'SUPERSEDED', why)))
    const notBefore = api === 'ads_api' ? adjustmentNotBefore(p) : dmAdjustmentNotBefore(p)
    if (now < notBefore) {
      await db.query(`UPDATE ads_conversion_uploads SET next_attempt_at = $2, updated_at = now() WHERE id = $1`, [target.id, notBefore])
      continue
    }
    targets.push({ row: { ...target, conversion_action: p.conversion_action }, purchase: p })
  }
  await applyUpdates(db, pre, now)
  tally(run, pre)
  return targets
}

// ---- Google Ads API path ----

async function onRequestError(ctx: RunCtx, rows: DueRow[], e: unknown): Promise<void> {
  const err = e instanceof GoogleAdsApiError ? e : null
  const message = requestErrorMessage(err?.codes ?? [], (e as Error)?.message ?? '')
  const code = err?.codes[0] ?? 'REQUEST_FAILED'
  const c: Classified = { outcome: 'retry', delayMs: 0, message: `${message}${message.includes(code) ? '' : ` (${code})`}` }
  const updates = rows.map(r => ({ ...afterFailure(r, c, ctx.now), code }))
  await applyUpdates(ctx.db, updates, ctx.now)
  tally(ctx.run, updates)
  ctx.run.error = message
  ctx.run.errorCode = code
}

function resultUpdates(ctx: RunCtx, rows: DueRow[], results: RowResult[], jobId: string | null, action: (r: DueRow) => string, values?: number[]): Update[] {
  return rows.map((r, i) => {
    const res = results[i]
    const sent = values?.[i] ?? null
    if (res.ok) return uploaded(r, sent, action(r), { jobId })
    const c = classifyRowError(r.kind, res.code, res.message)
    if (c.outcome === 'uploaded') return { ...uploaded(r, sent, action(r), { jobId }), code: res.code, error: c.message }
    if (c.outcome === 'skipped') return { ...skip(r.id, res.code, c.message), inc: 1, jobId }
    return { ...afterFailure(r, c, ctx.now), code: res.code || null, jobId }
  })
}

async function uploadPurchasesAdsApi(ctx: RunCtx): Promise<boolean> {
  const batch = await duePurchases(ctx.db, ctx.now, ctx.run)
  if (!batch) return true
  const { send, values, foldsById } = batch
  const opts = { action: ctx.action, timeZone: ctx.timeZone, identifiers: ctx.identifiers }
  const conversions = send.map((r, i) => buildClickConversion({ ...r, value: values[i] }, opts))
  try {
    const res = await ctx.ads.post<any>(':uploadClickConversions', { conversions, partialFailure: true, jobId: ctx.jobId })
    const updates = resultUpdates(ctx, send, mapPartialFailure(res, send.length, 'conversions'), str(res?.jobId), () => ctx.action, values)
    const folded = foldedUpdates(updates, foldsById)
    await applyUpdates(ctx.db, [...updates, ...folded], ctx.now)
    tally(ctx.run, updates)
    ctx.run.skipped += folded.length
    return true
  } catch (e) {
    await onRequestError(ctx, send, e)
    return false
  }
}

async function uploadAdjustmentsAdsApi(ctx: RunCtx): Promise<void> {
  const send = (await dueAdjustments(ctx.db, ctx.now, ctx.run, 'ads_api')).map(t => t.row)
  if (!send.length) return
  const actionOf = (r: DueRow) => r.conversion_action || ctx.action
  const conversionAdjustments = send.map(r => buildAdjustment(r, { action: actionOf(r), timeZone: ctx.timeZone }))
  try {
    const res = await ctx.ads.post<any>(':uploadConversionAdjustments', { conversionAdjustments, partialFailure: true, jobId: ctx.jobId })
    const updates = resultUpdates(ctx, send, mapPartialFailure(res, send.length, 'conversion_adjustments'), str(res?.jobId), actionOf)
    await applyUpdates(ctx.db, updates, ctx.now)
    tally(ctx.run, updates)
  } catch (e) {
    await onRequestError(ctx, send, e)
  }
}

// ---- Data Manager API path ----

interface Item {
  row: DueRow
  value: number
  purchase?: DueRow
}

const isBlocking = (e: DataManagerApiError) =>
  BLOCKING_CODES.has(e.code) || BLOCKING_CODES.has(e.status) || (!!e.reason && BLOCKING_CODES.has(e.reason))
const rejectsIdentifiers = (e: DataManagerApiError) =>
  IDENTIFIER_BLOCKERS.has(e.reason ?? '') || e.violations.some(v => IDENTIFIER_BLOCKERS.has(v.reason))

/**
 * events:ingest for one destination. A fast-fail rejection naming events settles those rows and
 * sends the rest again; one of the hashed email / phone sends again without them; a setup or auth
 * problem stops the run and leaves the rows queued as they are; anything else retries with backoff.
 */
async function ingest(
  ctx: DmCtx,
  kind: 'purchase' | 'adjustment',
  action: string,
  items: Item[],
  build: (it: Item, identifiers: boolean) => IngestEvent
): Promise<Update[]> {
  const updates: Update[] = []
  const destination = ctx.destinationFor(action)
  let pending = items
  let identifiers = ctx.identifiers
  for (let pass = 0; pending.length; pass++) {
    if (pass >= MAX_PASSES) {
      const c: Classified = { outcome: 'retry', delayMs: 0, message: 'Google rejected other events in the same upload; sent again in a later run.' }
      updates.push(...pending.map(it => ({ ...afterFailure(it.row, c, ctx.now), code: 'BATCH_REJECTED' })))
      break
    }
    const events = pending.map(it => build(it, identifiers))
    try {
      const res = await ctx.dm.ingestEvents({ destinations: [destination], events, encoding: 'HEX' })
      const requestId = res?.requestId ? String(res.requestId) : null
      if (requestId) {
        await recordRequest(ctx.db, { requestId, kind, events: events.length, fieldWarnings: res.fieldWarnings, now: ctx.now })
      }
      ctx.run.requests = (ctx.run.requests ?? 0) + 1
      updates.push(...pending.map(it => uploaded(it.row, it.value, action, { requestId })))
      break
    } catch (e) {
      const err = e instanceof DataManagerApiError ? e : null
      if (err && identifiers && rejectsIdentifiers(err)) {
        identifiers = false
        ctx.run.identifiers = false
        continue
      }
      const byEvent = err ? violationsByEvent(err.violations, pending.length) : null
      if (byEvent) {
        for (const [i, vs] of byEvent) updates.push(outcomeUpdate(pending[i].row, classifyEventViolation(vs[0]), vs[0].reason || null, ctx.now))
        pending = pending.filter((_, i) => !byEvent.has(i))
        continue
      }
      const message = String((e as Error)?.message ?? e).slice(0, 500)
      const code = err?.code ?? 'REQUEST_FAILED'
      ctx.run.error = message
      ctx.run.errorCode = code
      if (err && isBlocking(err)) {
        ctx.blocked = err
        break
      }
      const c: Classified = { outcome: 'retry', delayMs: 0, message }
      updates.push(...pending.map(it => ({ ...afterFailure(it.row, c, ctx.now), code })))
      break
    }
  }
  return updates
}

async function uploadPurchasesDm(ctx: DmCtx): Promise<void> {
  const batch = await duePurchases(ctx.db, ctx.now, ctx.run)
  if (!batch) return
  const items: Item[] = batch.send.map((row, i) => ({ row, value: batch.values[i] }))
  const updates = await ingest(ctx, 'purchase', ctx.action, items, (it, ids) => buildPurchaseEvent({ ...it.row, value: it.value }, ids))
  const folded = foldedUpdates(updates, batch.foldsById)
  await applyUpdates(ctx.db, [...updates, ...folded], ctx.now)
  tally(ctx.run, updates)
  ctx.run.skipped += folded.length
}

/** Adjustments go to the action their purchase was sent to, one request per action. */
async function uploadAdjustmentsDm(ctx: DmCtx): Promise<void> {
  const targets = await dueAdjustments(ctx.db, ctx.now, ctx.run, 'data_manager')
  const byAction = new Map<string, Item[]>()
  for (const t of targets) {
    const action = t.row.conversion_action || ctx.action
    const value = t.row.kind === 'retraction' ? 0 : Number(t.row.value)
    byAction.set(action, [...(byAction.get(action) ?? []), { row: t.row, value, purchase: t.purchase }])
  }
  for (const [action, items] of byAction) {
    if (ctx.blocked) break
    const updates = await ingest(ctx, 'adjustment', action, items, (it, ids) => buildAdjustmentEvent(it.row, it.purchase!, ids, ctx.now))
    await applyUpdates(ctx.db, updates, ctx.now)
    tally(ctx.run, updates)
  }
}

const str = (v: unknown) => (v == null || v === '' ? null : String(v))

/** Pending rows Google would reject for age: clicks past 90 days, adjustments past 54 days. */
async function expireRows(db: Db, now: Date, run: UploadRunSummary): Promise<void> {
  const clicks = await db.query(
    `UPDATE ads_conversion_uploads SET status = 'skipped', error_code = 'CLICK_WINDOW', error = $2, updated_at = now()
     WHERE status = 'pending' AND kind = 'purchase' AND COALESCE(click_at, conversion_at) < $1 RETURNING id`,
    [new Date(now.getTime() - CLICK_WINDOW_DAYS * DAY), `The ad click is more than ${CLICK_WINDOW_DAYS} days old, past Google's click window; not uploaded.`]
  )
  const adjustments = await db.query(
    `UPDATE ads_conversion_uploads SET status = 'skipped', error_code = 'ADJUSTMENT_WINDOW', error = $2, updated_at = now()
     WHERE status = 'pending' AND kind <> 'purchase' AND conversion_at < $1 RETURNING id`,
    [new Date(now.getTime() - ADJUST_WINDOW_DAYS * DAY), `Google only takes adjustments within ${ADJUST_WINDOW_DAYS} days of the purchase.`]
  )
  run.skipped += (clicks.rowCount ?? clicks.rows.length) + (adjustments.rowCount ?? adjustments.rows.length)
}

const newRun = (): UploadRunSummary => ({
  status: 'idle',
  uploaded: 0,
  failed: 0,
  retrying: 0,
  skipped: 0,
  enqueued: 0,
  error: null,
  errorCode: null,
  identifiers: false,
  finishedAt: '',
})

/** Google's job_id groups a run's requests in the diagnostics; must be in [1, 2^31). */
export const jobIdFor = (now: Date) => (Math.floor(now.getTime() / 1000) % 2147483646) + 1

const customerOf = (resource: string) => normalizeCustomerId(resource.split('/')[1] ?? '')

/** One upload run for the current store. Throws ConversionUploadInProgressError on overlap. */
export async function uploadConversions(
  opts: { client?: GoogleAdsClient; dm?: DataManagerClient; now?: Date } = {}
): Promise<UploadRunSummary> {
  const now = opts.now ?? new Date()
  const conn: PoolClient = await getClient()
  const db: Db = conn
  let locked = false
  let unlockFailed = false
  const run = newRun()
  const finish = async (status: UploadRunSummary['status']) => {
    run.status = status
    run.finishedAt = new Date().toISOString()
    await db
      .query(`UPDATE ads_account SET conversion_last_run_at = now(), conversion_last_run = $1::jsonb WHERE id = 1`, [JSON.stringify(run)])
      .catch(() => {})
    return run
  }
  try {
    locked = !!(await db.query('SELECT pg_try_advisory_lock($1) AS acquired', [ADS_CONVERSIONS_LOCK_KEY])).rows[0]?.acquired
    if (!locked) throw new ConversionUploadInProgressError()

    run.enqueued = (await sweepConversions(db, now)).enqueued
    await expireRows(db, now, run)

    const cfg = await readConversionConfig(db)
    run.api = cfg.uploadApi
    if (!cfg.action || !cfg.matchesAccount) return await finish('not_configured')

    let ads: GoogleAdsClient
    let creds: GoogleAdsCreds | null = null
    try {
      if (opts.client) ads = opts.client
      else {
        creds = await resolveGoogleAdsCreds()
        ads = googleAdsClientFromCreds(creds)
      }
    } catch (e: any) {
      run.error = String(e?.message ?? e).slice(0, 500)
      return await finish('error')
    }
    // Chosen for another account than the one connected now: leave the queue alone.
    if (cfg.account && normalizeCustomerId(cfg.account) !== ads.customerId) return await finish('not_configured')

    const owner = normalizeCustomerId(cfg.owner) || ads.customerId
    const uploader = owner !== ads.customerId ? ads.forCustomer(owner) : ads
    run.identifiers = identifiersAllowed(await readTrackingSettings(uploader).catch(() => null))

    if (cfg.uploadApi === 'ads_api') {
      const ctx: RunCtx = {
        db,
        ads: uploader,
        action: cfg.action,
        timeZone: await accountTimeZone(db),
        identifiers: run.identifiers,
        now,
        jobId: jobIdFor(now),
        run,
      }
      if (await uploadPurchasesAdsApi(ctx)) await uploadAdjustmentsAdsApi(ctx)
    } else {
      let dm: DataManagerClient
      try {
        dm = opts.dm ?? dataManagerClientFor(creds ?? (await resolveGoogleAdsCreds()))
      } catch (e: any) {
        run.error = String(e?.message ?? e).slice(0, 500)
        return await finish('error')
      }
      const chosen = cfg.action
      const ctx: DmCtx = {
        db,
        dm,
        action: chosen,
        // The chosen action's owner is known; an older action's account is the one in its resource name.
        destinationFor: action =>
          adsDestination({
            operating: action === chosen ? owner : customerOf(action) || owner,
            login: ads.loginCustomerId,
            actionId: actionIdOf(action),
          }),
        identifiers: run.identifiers,
        now,
        run,
        blocked: null,
      }
      run.requests = 0
      const polled = await pollRequestStatuses({ db, dm, now, run })
      run.checked = polled.checked
      if (polled.blocked) {
        ctx.blocked = polled.blocked
        run.error = polled.blocked.message
        run.errorCode = polled.blocked.code
      }
      if (!ctx.blocked) await uploadPurchasesDm(ctx)
      if (!ctx.blocked) await uploadAdjustmentsDm(ctx)
    }
    const status = run.error ? (run.uploaded > 0 ? 'partial' : 'error') : run.failed > 0 ? 'partial' : 'success'
    return await finish(status)
  } finally {
    if (locked) {
      await db.query('SELECT pg_advisory_unlock($1)', [ADS_CONVERSIONS_LOCK_KEY]).catch(() => {
        unlockFailed = true
      })
    }
    conn.release(unlockFailed || undefined)
  }
}

export async function isConversionUploadRunning(): Promise<boolean> {
  try {
    const row = await queryOne<{ running: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND classid = 0 AND objid = $1 AND objsubid = 1
       ) AS running`,
      [ADS_CONVERSIONS_LOCK_KEY]
    )
    return !!row?.running
  } catch {
    return false
  }
}
