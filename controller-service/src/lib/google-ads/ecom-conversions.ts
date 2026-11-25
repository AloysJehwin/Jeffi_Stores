import { controlPlanePool } from '@/lib/tenant-registry'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { GoogleAdsApiError, type GoogleAdsClient } from '@/lib/google-ads/client'
import { googleAdsClientFromCreds, resolveGoogleAdsCreds, type GoogleAdsCreds } from '@/lib/google-ads/credentials'
import { actionIdOf, listConversionActions, readTrackingSettings } from '@/lib/google-ads/conversions/actions'
import {
  DataManagerApiError,
  adsDestination,
  dataManagerClientFor,
  violationsByEvent,
  type DataManagerClient,
  type IngestEvent,
} from '@/lib/google-ads/conversions/data-manager'

// Offline conversions for the platform's own Google Ads account: an ecom owner who arrived from an ad (a click id saved
// in owner_attribution) is owed one conversion per action. Hooks only queue a row (owner_conversion_uploads, unique per
// owner and action) and never throw; the ecom_conversions cron sends the pending rows through the Data Manager API.

export const ECOM_CONVERSION_ACTIONS = ['ecom_signup', 'showcase_published', 'subscription_paid'] as const
export type EcomConversionAction = (typeof ECOM_CONVERSION_ACTIONS)[number]

interface ActionDef {
  category: string
  /** Primary actions steer bidding; the rest are reported only. */
  primary: boolean
}

export const ACTION_DEFS: Record<EcomConversionAction, ActionDef> = {
  ecom_signup: { category: 'SIGNUP', primary: true },
  showcase_published: { category: 'ENGAGEMENT', primary: false },
  subscription_paid: { category: 'SUBSCRIBE_PAID', primary: false },
}

export const MAX_ATTEMPTS = 8
const BATCH = 500
const backoffMs = (attempts: number) => Math.min(6 * 60 * 60 * 1000, 10 * 60 * 1000 * 2 ** Math.max(0, attempts - 1))

interface Pool {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

const hasClick = `(a.gclid IS NOT NULL OR a.gbraid IS NOT NULL OR a.wbraid IS NOT NULL)`

/** Queue one owner's conversion; true when a row was added. Owners without a click id are not queued. */
export async function enqueueOwnerConversion(
  ownerId: string,
  action: EcomConversionAction,
  opts: { valueInr?: number; occurredAt?: Date; pool?: Pool } = {}
): Promise<boolean> {
  const r = await (opts.pool ?? controlPlanePool()).query(
    `INSERT INTO owner_conversion_uploads (owner_id, action, value_inr, occurred_at)
     SELECT a.owner_id, $2, $3, $4 FROM owner_attribution a WHERE a.owner_id = $1 AND ${hasClick}
     ON CONFLICT (owner_id, action) DO NOTHING`,
    [ownerId, action, Math.max(0, opts.valueInr ?? 0), (opts.occurredAt ?? new Date()).toISOString()]
  )
  return (r.rowCount ?? 0) > 0
}

/** Queue a conversion for the owner(s) of a tenant (a subscription belongs to a tenant). */
export async function enqueueTenantConversion(
  tenantId: string,
  action: EcomConversionAction,
  opts: { valueInr?: number; occurredAt?: Date; pool?: Pool } = {}
): Promise<number> {
  const r = await (opts.pool ?? controlPlanePool()).query(
    `INSERT INTO owner_conversion_uploads (owner_id, action, value_inr, occurred_at)
     SELECT a.owner_id, $2, $3, $4 FROM owner_tenants ot JOIN owner_attribution a ON a.owner_id = ot.owner_id
     WHERE ot.tenant_id = $1 AND ${hasClick}
     ON CONFLICT (owner_id, action) DO NOTHING`,
    [tenantId, action, Math.max(0, opts.valueInr ?? 0), (opts.occurredAt ?? new Date()).toISOString()]
  )
  return r.rowCount ?? 0
}

export interface EcomActionRef {
  resourceName: string
  /** The Google Ads customer that owns the action: the operating account for the upload. */
  owner: string
  created: boolean
}

/** Find or create the three import actions (UPLOAD_CLICKS) in the account's conversion customer. */
export async function ensureEcomConversionActions(ads: GoogleAdsClient): Promise<Record<EcomConversionAction, EcomActionRef>> {
  const settings = await readTrackingSettings(ads).catch(() => null)
  const ownerId = settings?.conversionCustomer && settings.conversionCustomer !== ads.customerId ? settings.conversionCustomer : null
  const target = ownerId ? ads.forCustomer(ownerId) : ads
  const existing = await listConversionActions(target)
  const out = {} as Record<EcomConversionAction, EcomActionRef>
  const missing: EcomConversionAction[] = []
  for (const name of ECOM_CONVERSION_ACTIONS) {
    const a = existing.find(x => x.name === name && x.type === 'UPLOAD_CLICKS' && x.status === 'ENABLED')
    if (a) out[name] = { resourceName: a.resourceName, owner: target.customerId, created: false }
    else missing.push(name)
  }
  if (missing.length) {
    try {
      await target.post('/conversionActions:mutate', {
        operations: missing.map(name => ({
          create: {
            name,
            type: 'UPLOAD_CLICKS',
            category: ACTION_DEFS[name].category,
            status: 'ENABLED',
            countingType: 'ONE_PER_CLICK',
            clickThroughLookbackWindowDays: 90,
            primaryForGoal: ACTION_DEFS[name].primary,
            valueSettings: { defaultValue: 0, defaultCurrencyCode: 'INR', alwaysUseDefaultValue: false },
          },
        })),
      })
    } catch (e) {
      // A retried create that already went through reports a duplicate name; read them back below.
      if (!(e instanceof GoogleAdsApiError && e.codes.includes('DUPLICATE_NAME'))) throw e
    }
    const after = await listConversionActions(target)
    for (const name of missing) {
      const a = after.find(x => x.name === name && x.type === 'UPLOAD_CLICKS' && x.status === 'ENABLED')
      if (!a) throw new Error(`Google Ads did not return the conversion action ${name}`)
      out[name] = { resourceName: a.resourceName, owner: target.customerId, created: true }
    }
  }
  return out
}

export interface UploadSummary {
  skipped?: 'not_connected' | 'nothing_pending' | 'actions_unavailable'
  picked: number
  uploaded: number
  failed: number
  retrying: number
}

export interface UploadDeps {
  pool?: Pool
  creds?: GoogleAdsCreds
  ads?: GoogleAdsClient
  dm?: DataManagerClient
  now?: Date
  maxAttempts?: number
}

interface PendingRow {
  id: string
  owner_id: string
  action: EcomConversionAction
  value_inr: string | number
  occurred_at: Date | string
  attempts: number
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
}

const stamp = (d: Date | string) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z')

function toEvent(r: PendingRow): IngestEvent {
  const id = r.gclid ? { gclid: r.gclid } : r.gbraid ? { gbraid: r.gbraid } : { wbraid: r.wbraid ?? undefined }
  return {
    transactionId: `${r.action}:${r.owner_id}`,
    eventTimestamp: stamp(r.occurred_at),
    eventSource: 'WEB',
    conversionValue: Number(r.value_inr) || 0,
    currency: 'INR',
    adIdentifiers: id,
  }
}

const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 500)

/** Send every due pending conversion; each one is sent once (uploaded rows are never picked again). */
export async function uploadPendingConversions(deps: UploadDeps = {}): Promise<UploadSummary> {
  const pool = deps.pool ?? controlPlanePool()
  const now = deps.now ?? new Date()
  const max = deps.maxAttempts ?? MAX_ATTEMPTS
  const summary: UploadSummary = { picked: 0, uploaded: 0, failed: 0, retrying: 0 }

  const rows = (
    await pool.query(
      `SELECT u.id, u.owner_id, u.action, u.value_inr, u.occurred_at, u.attempts, a.gclid, a.gbraid, a.wbraid
         FROM owner_conversion_uploads u JOIN owner_attribution a ON a.owner_id = u.owner_id
        WHERE u.status = 'pending' AND u.next_attempt_at <= $1
        ORDER BY u.created_at LIMIT ${BATCH}`,
      [now.toISOString()]
    )
  ).rows as PendingRow[]
  if (!rows.length) return { ...summary, skipped: 'nothing_pending' }
  summary.picked = rows.length

  let creds = deps.creds
  if (!creds) {
    try {
      creds = await resolveGoogleAdsCreds(PLATFORM_TENANT_ID)
    } catch {
      return { ...summary, skipped: 'not_connected' }
    }
  }

  const retry = async (ids: string[], attempts: Map<string, number>, error: string) => {
    for (const id of ids) {
      const next = (attempts.get(id) ?? 0) + 1
      const dead = next >= max
      await pool.query(
        `UPDATE owner_conversion_uploads SET attempts = $2, last_error = $3, status = $4, next_attempt_at = $5, updated_at = now() WHERE id = $1`,
        [id, next, error, dead ? 'failed' : 'pending', new Date(now.getTime() + backoffMs(next)).toISOString()]
      )
      if (dead) summary.failed++
      else summary.retrying++
    }
  }
  const attemptsOf = new Map(rows.map(r => [r.id, r.attempts]))

  let refs: Record<EcomConversionAction, EcomActionRef>
  try {
    const ads = deps.ads ?? googleAdsClientFromCreds(creds)
    refs = await ensureEcomConversionActions(ads)
  } catch (e) {
    await retry(rows.map(r => r.id), attemptsOf, `conversion actions: ${msg(e)}`)
    return { ...summary, skipped: 'actions_unavailable' }
  }
  const dm = deps.dm ?? dataManagerClientFor(creds)

  for (const action of ECOM_CONVERSION_ACTIONS) {
    const group = rows.filter(r => r.action === action)
    if (!group.length) continue
    const ref = refs[action]
    // Google may refuse a just-created action for a few hours; the retry backoff covers it.
    const events = group.map(toEvent)
    try {
      const res = await dm.ingestEvents({
        destinations: [adsDestination({ operating: ref.owner, login: creds.loginCustomerId, actionId: actionIdOf(ref.resourceName) })],
        events,
        encoding: 'HEX',
      })
      for (const r of group) {
        await pool.query(
          `UPDATE owner_conversion_uploads SET status = 'uploaded', uploaded_at = $2, request_id = $3, attempts = attempts + 1, last_error = NULL, updated_at = now() WHERE id = $1`,
          [r.id, now.toISOString(), res?.requestId ?? null]
        )
        summary.uploaded++
      }
    } catch (e) {
      const bad = e instanceof DataManagerApiError ? violationsByEvent(e.violations, events.length) : null
      if (bad) {
        // Google named the events it rejected: those fail for good, the rest are sent again next run.
        for (const [i, v] of bad) {
          await pool.query(
            `UPDATE owner_conversion_uploads SET status = 'failed', attempts = attempts + 1, last_error = $2, updated_at = now() WHERE id = $1`,
            [group[i].id, v.map(x => `${x.reason}: ${x.description}`).join('; ').slice(0, 500)]
          )
          summary.failed++
        }
        summary.retrying += group.length - bad.size
      } else {
        await retry(group.map(r => r.id), attemptsOf, msg(e))
      }
    }
  }
  return summary
}
