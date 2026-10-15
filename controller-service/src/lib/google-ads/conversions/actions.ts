import { query } from '@/lib/shared/db'
import { GoogleAdsApiError, normalizeCustomerId, type AdsRow, type GoogleAdsClient } from '../client'
import type { Db } from './queue'
import {
  SERVER_ACTION_NAME,
  type ConversionConfig,
  type ConversionTrackingSettings,
  type GoogleConversionAction,
  type GoogleConversionsData,
  type OfflineDiagnostics,
  type OfflineSummaryCounts,
  type UploadApi,
  type UploadRunSummary,
} from './types'

// Conversion actions, the account's conversion-tracking settings and Google's offline upload
// diagnostics, plus the store's choice of action in ads_account.

const defaultDb: Db = { query: (text, params) => query(text, params) }

const RESOURCE_RE = /^customers\/\d+\/conversionActions\/\d+$/
export const isActionResourceName = (s: unknown): s is string => typeof s === 'string' && RESOURCE_RE.test(s)
/** The numeric id the Data Manager API takes as productDestinationId. */
export const actionIdOf = (resource: string | null | undefined): string => String(resource ?? '').split('/').pop() ?? ''

const cid = (resource: unknown): string | null => normalizeCustomerId(String(resource ?? '').split('/')[1] ?? '') || null
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const int = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const ACTION_FIELDS = `conversion_action.resource_name, conversion_action.id, conversion_action.name,
       conversion_action.type, conversion_action.status, conversion_action.category,
       conversion_action.primary_for_goal, conversion_action.counting_type, conversion_action.owner_customer,
       conversion_action.origin, conversion_action.click_through_lookback_window_days,
       conversion_action.value_settings.default_currency_code, conversion_action.value_settings.always_use_default_value`

export function mapConversionAction(row: AdsRow): GoogleConversionAction {
  const a = row.conversionAction ?? {}
  return {
    resourceName: String(a.resourceName ?? ''),
    id: String(a.id ?? ''),
    name: String(a.name ?? ''),
    type: str(a.type),
    status: str(a.status),
    category: str(a.category),
    primaryForGoal: a.primaryForGoal == null ? null : !!a.primaryForGoal,
    countingType: str(a.countingType),
    owner: a.ownerCustomer ? cid(a.ownerCustomer) : cid(a.resourceName),
    origin: str(a.origin),
    lookbackDays: a.clickThroughLookbackWindowDays == null ? null : int(a.clickThroughLookbackWindowDays),
    defaultCurrency: str(a.valueSettings?.defaultCurrencyCode),
    alwaysUseDefaultValue: a.valueSettings?.alwaysUseDefaultValue == null ? null : !!a.valueSettings.alwaysUseDefaultValue,
  }
}

export async function listConversionActions(ads: GoogleAdsClient): Promise<GoogleConversionAction[]> {
  const rows = await ads.searchStream(
    `SELECT ${ACTION_FIELDS}
     FROM conversion_action
     WHERE conversion_action.status != 'REMOVED'
     ORDER BY conversion_action.name`
  )
  return rows.map(mapConversionAction).filter(a => a.resourceName)
}

async function findAction(ads: GoogleAdsClient, where: string): Promise<GoogleConversionAction | null> {
  const rows = await ads.searchStream(`SELECT ${ACTION_FIELDS} FROM conversion_action WHERE ${where} LIMIT 1`)
  return rows.length ? mapConversionAction(rows[0]) : null
}

export async function readTrackingSettings(ads: GoogleAdsClient): Promise<ConversionTrackingSettings> {
  const row = (
    await ads.searchStream(
      `SELECT customer.id, customer.conversion_tracking_setting.google_ads_conversion_customer,
         customer.conversion_tracking_setting.conversion_tracking_status,
         customer.conversion_tracking_setting.accepted_customer_data_terms,
         customer.conversion_tracking_setting.effective_enablement_setting
       FROM customer`
    )
  )[0]
  const s = row?.customer?.conversionTrackingSetting ?? {}
  return {
    conversionCustomer: s.googleAdsConversionCustomer ? cid(s.googleAdsConversionCustomer) : null,
    trackingStatus: str(s.conversionTrackingStatus),
    acceptedCustomerDataTerms: s.acceptedCustomerDataTerms == null ? null : !!s.acceptedCustomerDataTerms,
    enhancedConversions: str(s.effectiveEnablementSetting),
  }
}

/** Hashed email / phone go to Google only with the data terms accepted and enhanced conversions on. */
export const identifiersAllowed = (s: ConversionTrackingSettings | null) =>
  !!s && s.acceptedCustomerDataTerms === true && s.enhancedConversions === 'ON'

function counts(list: any[], keyOf: (s: any) => unknown): OfflineSummaryCounts[] {
  return (Array.isArray(list) ? list : []).map(s => ({
    key: String(keyOf(s) ?? ''),
    successful: int(s?.successfulCount),
    failed: int(s?.failedCount),
    pending: int(s?.pendingCount),
  }))
}

export function mapDiagnostics(row: AdsRow, scope: OfflineDiagnostics['scope']): OfflineDiagnostics {
  const d = (scope === 'account' ? row.offlineConversionUploadClientSummary : row.offlineConversionUploadConversionActionSummary) ?? {}
  const total = int(d.totalEventCount)
  const successful = int(d.successfulEventCount)
  return {
    scope,
    client: str(d.client),
    actionName: scope === 'action' ? str(d.conversionActionName) : null,
    status: str(d.status),
    total,
    successful,
    pending: int(d.pendingEventCount),
    successRate: d.successRate != null ? Number(d.successRate) : total > 0 ? successful / total : null,
    lastUpload: str(d.lastUploadDateTime),
    alerts: (Array.isArray(d.alerts) ? d.alerts : []).map((a: any) => ({
      error: String(Object.values(a?.error ?? {})[0] ?? 'UNKNOWN'),
      percent: a?.errorPercentage == null ? null : Number(a.errorPercentage),
    })),
    daily: counts(d.dailySummaries, s => s?.uploadDate),
    jobs: counts(d.jobSummaries, s => s?.jobId),
  }
}

/** Google's view of recent imports: account level, then per conversion action. Query the conversion customer. */
export async function readDiagnostics(ads: GoogleAdsClient): Promise<OfflineDiagnostics[]> {
  const common = `client, status, total_event_count, successful_event_count, pending_event_count,
       last_upload_date_time, alerts, daily_summaries, job_summaries`
  const prefix = (t: string) => common.split(',').map(f => `${t}.${f.trim()}`).join(', ')
  const account = await ads.searchStream(
    `SELECT ${prefix('offline_conversion_upload_client_summary')}, offline_conversion_upload_client_summary.success_rate
     FROM offline_conversion_upload_client_summary`
  )
  const actions = await ads.searchStream(
    `SELECT ${prefix('offline_conversion_upload_conversion_action_summary')},
       offline_conversion_upload_conversion_action_summary.conversion_action_id,
       offline_conversion_upload_conversion_action_summary.conversion_action_name
     FROM offline_conversion_upload_conversion_action_summary`
  )
  return [...account.map(r => mapDiagnostics(r, 'account')), ...actions.map(r => mapDiagnostics(r, 'action'))]
}

export async function readConversionConfig(db: Db = defaultDb): Promise<ConversionConfig> {
  const row = (
    await db.query(
      `SELECT customer_id, conversion_action, conversion_action_name, conversion_action_owner, conversion_action_account,
              conversion_action_set_at, conversion_last_run_at, conversion_last_run, conversion_upload_api, time_zone
       FROM ads_account WHERE id = 1`
    )
  ).rows[0]
  const action = row?.conversion_action ?? null
  const account = row?.conversion_action_account != null ? String(row.conversion_action_account) : null
  const connected = row?.customer_id != null ? String(row.customer_id) : null
  return {
    action,
    actionName: row?.conversion_action_name ?? null,
    owner: row?.conversion_action_owner != null ? String(row.conversion_action_owner) : null,
    account,
    setAt: row?.conversion_action_set_at ? new Date(row.conversion_action_set_at).toISOString() : null,
    connectedCustomer: connected,
    matchesAccount: !!action && (!account || !connected || account === connected),
    lastRunAt: row?.conversion_last_run_at ? new Date(row.conversion_last_run_at).toISOString() : null,
    lastRun: (row?.conversion_last_run as UploadRunSummary | null) ?? null,
    uploadApi: row?.conversion_upload_api === 'ads_api' ? 'ads_api' : 'data_manager',
  }
}

/** Per store: Data Manager API (default) or the Google Ads API upload, for tokens Google still allows. */
export async function setUploadApi(api: UploadApi, db: Db = defaultDb): Promise<boolean> {
  const r = await db.query(
    `UPDATE ads_account SET conversion_upload_api = $1, updated_at = now() WHERE id = 1 RETURNING id`,
    [api]
  )
  return (r.rowCount ?? r.rows.length) > 0
}

/** The account time zone from the last sync (conversion times are sent in it). */
export async function accountTimeZone(db: Db = defaultDb): Promise<string> {
  const row = (await db.query(`SELECT time_zone FROM ads_account WHERE id = 1`)).rows[0]
  return row?.time_zone || 'Asia/Kolkata'
}

async function saveChoice(ads: GoogleAdsClient, a: GoogleConversionAction, db: Db): Promise<void> {
  await db.query(
    `INSERT INTO ads_account (id, customer_id, conversion_action, conversion_action_name, conversion_action_owner,
       conversion_action_account, conversion_action_set_at, updated_at)
     VALUES (1, $1, $2, $3, $4, $1, now(), now())
     ON CONFLICT (id) DO UPDATE SET conversion_action = EXCLUDED.conversion_action,
       conversion_action_name = EXCLUDED.conversion_action_name, conversion_action_owner = EXCLUDED.conversion_action_owner,
       conversion_action_account = EXCLUDED.conversion_action_account, conversion_action_set_at = now(), updated_at = now()`,
    [ads.customerId, a.resourceName, a.name, a.owner ?? ads.customerId]
  )
}

export class ConversionActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversionActionError'
  }
}

/** Upload to an existing action: it must be an enabled import (UPLOAD_CLICKS) action. */
export async function chooseConversionAction(
  ads: GoogleAdsClient,
  resourceName: string,
  db: Db = defaultDb
): Promise<GoogleConversionAction> {
  if (!isActionResourceName(resourceName)) throw new ConversionActionError('That is not a conversion action.')
  const a = await findAction(ads, `conversion_action.resource_name = '${resourceName}'`)
  if (!a) throw new ConversionActionError('That conversion action was not found in this Google Ads account.')
  if (a.type !== 'UPLOAD_CLICKS') {
    throw new ConversionActionError(`"${a.name}" is a ${a.type ?? 'different'} action. Pick an import (UPLOAD_CLICKS) action.`)
  }
  if (a.status !== 'ENABLED') throw new ConversionActionError(`"${a.name}" is ${a.status ?? 'not enabled'}. Enable it in Google Ads first.`)
  await saveChoice(ads, a, db)
  return a
}

/**
 * Find or create "Purchase (server)" (UPLOAD_CLICKS, PURCHASE, many per click, 90-day window, INR) in
 * the conversion customer and upload to it. Secondary unless `primary`, so it never silently double counts.
 */
export async function createServerConversionAction(
  ads: GoogleAdsClient,
  opts: { primary: boolean },
  db: Db = defaultDb
): Promise<{ action: GoogleConversionAction; created: boolean }> {
  const settings = await readTrackingSettings(ads).catch(() => null)
  const owner = settings?.conversionCustomer && settings.conversionCustomer !== ads.customerId ? settings.conversionCustomer : null
  const target = owner ? ads.forCustomer(owner) : ads
  const byName = `conversion_action.name = '${SERVER_ACTION_NAME}' AND conversion_action.type = 'UPLOAD_CLICKS' AND conversion_action.status = 'ENABLED'`
  let action = await findAction(target, byName)
  let created = false
  if (!action) {
    try {
      await target.post('/conversionActions:mutate', {
        operations: [
          {
            create: {
              name: SERVER_ACTION_NAME,
              type: 'UPLOAD_CLICKS',
              category: 'PURCHASE',
              status: 'ENABLED',
              countingType: 'MANY_PER_CLICK',
              clickThroughLookbackWindowDays: 90,
              primaryForGoal: opts.primary,
              valueSettings: { defaultValue: 0, defaultCurrencyCode: 'INR', alwaysUseDefaultValue: false },
            },
          },
        ],
      })
      created = true
    } catch (e) {
      // A retried create that already went through reports a duplicate name; use that action.
      if (!(e instanceof GoogleAdsApiError && e.codes.includes('DUPLICATE_NAME'))) throw e
    }
    action = await findAction(target, byName)
    if (!action) throw new ConversionActionError('Google Ads did not return the new conversion action. Refresh and try again.')
  }
  await saveChoice(ads, { ...action, owner: action.owner ?? target.customerId }, db)
  return { action, created }
}

/** Live Google side of the Conversions tab; each part fails on its own. */
export async function loadGoogleConversions(ads: GoogleAdsClient): Promise<GoogleConversionsData> {
  const errors: GoogleConversionsData['errors'] = []
  const step = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (e: any) {
      errors.push({ step: name, message: String(e?.message ?? e).slice(0, 500) })
      return fallback
    }
  }
  const settings = await step<ConversionTrackingSettings | null>('settings', () => readTrackingSettings(ads), null)
  const conv = settings?.conversionCustomer && settings.conversionCustomer !== ads.customerId ? ads.forCustomer(settings.conversionCustomer) : ads
  const [actions, diagnostics] = await Promise.all([
    step('actions', () => listConversionActions(ads), [] as GoogleConversionAction[]),
    step('diagnostics', () => readDiagnostics(conv), [] as OfflineDiagnostics[]),
  ])
  return { actions, settings, diagnostics, errors }
}

export async function clearConversionAction(db: Db = defaultDb): Promise<void> {
  await db.query(
    `UPDATE ads_account SET conversion_action = NULL, conversion_action_name = NULL, conversion_action_owner = NULL,
       conversion_action_account = NULL, conversion_action_set_at = NULL, updated_at = now() WHERE id = 1`
  )
}
