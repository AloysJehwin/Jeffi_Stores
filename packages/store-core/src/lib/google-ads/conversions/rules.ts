import type { ConversionKind, UploadStatus } from './types'

// Server-side conversion rules. Value = orders.total_amount (incl. tax and shipping), the value the
// Google tag's purchase event sends. Cancelled / fully refunded = 0 (retraction); a refund return =
// total less returned items (restatement); a replacement keeps the sale; an edited total is restated.
// The Data Manager API has no retraction: it restates the value to 0 and the conversion still counts.

export const CLICK_WINDOW_DAYS = 90
/** Google rejects adjustments to conversions older than this (CONVERSION_EXPIRED). */
export const ADJUST_WINDOW_DAYS = 54
/** Clicks younger than this get TOO_RECENT_EVENT. */
export const CLICK_SETTLE_HOURS = 6
/** Adjustments sooner than this after the conversion get TOO_RECENT_CONVERSION. */
export const ADJUST_AFTER_CONVERSION_HOURS = 24
/** Give Google time to process the purchase before adjusting it (else CONVERSION_NOT_FOUND). */
export const ADJUST_AFTER_UPLOAD_HOURS = 6
export const MAX_ATTEMPTS = 8
/** Google caps uploads at 2000 conversions / adjustments / events per request. */
export const BATCH_SIZE = 2000
/** Data Manager processes a request within this; adjustments wait for it (or a confirmed status). */
export const DM_PROCESSING_HOURS = 24
/** Google's suggested polling: first status read 30 min after the request, x1.3 up to an hour, 24 h at most. */
export const POLL_FIRST_MIN = 30
export const POLL_MAX_MIN = 60
export const POLL_MULTIPLIER = 1.3

const HOUR = 3_600_000
const DAY = 24 * HOUR

export interface ClickIds {
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
}

export interface OrderConversionState extends ClickIds {
  id: string
  order_number: string
  status: string | null
  payment_status: string | null
  payment_mode: string | null
  total_amount: number | string
  attributed_at: Date | string | null
  created_at: Date | string
  delivered_at: Date | string | null
  /** Latest return request: 'refund' | 'replacement'. */
  return_type: string | null
  /** Sum of that request's returned item refund amounts. */
  returned_value: number | string | null
  returned_items: number | null
}

export interface QueueRowLite {
  kind: ConversionKind
  version: number
  value: number | string
  status: UploadStatus
  conversion_at: Date | string
  adjustment_at: Date | string | null
}

export interface PlannedRow {
  kind: ConversionKind
  version: number
  value: number
  clickAt: Date | null
  conversionAt: Date
  adjustmentAt: Date | null
  nextAttemptAt: Date
}

export const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
export const toDate = (v: Date | string | null | undefined): Date | null => {
  if (v == null || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
const latest = (...ds: (Date | null)[]) => new Date(Math.max(...ds.filter((d): d is Date => !!d).map(d => d.getTime())))

export function hasClickId(c: ClickIds | null | undefined): boolean {
  return !!(c?.gclid || c?.gbraid || c?.wbraid)
}

const PAID = new Set(['paid', 'cod_collected', 'refunded', 'partially_refunded'])

/** A sale has happened: paid online, or a COD order delivered. */
export function isConverted(o: Pick<OrderConversionState, 'payment_status' | 'payment_mode' | 'delivered_at'>): boolean {
  if (PAID.has(String(o.payment_status ?? ''))) return true
  return o.payment_mode === 'cod' && !!toDate(o.delivered_at)
}

export function conversionValue(o: OrderConversionState): number {
  const total = Math.max(0, num(o.total_amount))
  if (o.status === 'cancelled' || o.payment_status === 'cancelled') return 0
  if (o.status === 'returned') {
    if (o.return_type === 'replacement') return round2(total)
    if (num(o.returned_items) > 0) return Math.max(0, round2(total - num(o.returned_value)))
    return 0
  }
  if (o.payment_status === 'refunded') return 0
  return round2(total)
}

/** When the sale happened: delivery for COD, else the order (paid at creation or right after). */
export function conversionTime(o: OrderConversionState, now: Date): Date {
  const base = (o.payment_mode === 'cod' ? toDate(o.delivered_at) : toDate(o.created_at)) ?? now
  const click = toDate(o.attributed_at)
  const t = click && base.getTime() <= click.getTime() ? new Date(click.getTime() + 1000) : base
  return t.getTime() > now.getTime() ? now : t
}

/** The one queue row an order needs now, or null. Append-only (the upload job owns statuses) and idempotent. */
export function planConversion(o: OrderConversionState, rows: QueueRowLite[], now: Date): PlannedRow | null {
  if (!hasClickId(o)) return null
  const value = conversionValue(o)
  const purchase = rows.find(r => r.kind === 'purchase')
  if (!purchase) {
    if (!isConverted(o) || value <= 0) return null
    const clickAt = toDate(o.attributed_at)
    return {
      kind: 'purchase',
      version: 0,
      value,
      clickAt,
      conversionAt: conversionTime(o, now),
      adjustmentAt: null,
      nextAttemptAt: latest(now, clickAt ? new Date(clickAt.getTime() + CLICK_SETTLE_HOURS * HOUR) : null),
    }
  }
  if (rows.some(r => r.kind === 'retraction')) return null
  const restatements = rows.filter(r => r.kind === 'restatement').sort((a, b) => a.version - b.version)
  const last = restatements[restatements.length - 1]
  const conversionAt = toDate(purchase.conversion_at) ?? now
  // Each adjustment needs a later time than the previous one, or Google drops it as a duplicate.
  const adjustmentAt = latest(
    now,
    new Date(conversionAt.getTime() + 1000),
    last ? new Date((toDate(last.adjustment_at) ?? now).getTime() + 1000) : null
  )
  const nextAttemptAt = latest(now, new Date(conversionAt.getTime() + ADJUST_AFTER_CONVERSION_HOURS * HOUR))
  if (value <= 0) {
    return { kind: 'retraction', version: 0, value: 0, clickAt: null, conversionAt, adjustmentAt, nextAttemptAt }
  }
  if (Math.abs(value - num((last ?? purchase).value)) < 0.005) return null
  return {
    kind: 'restatement',
    version: (last?.version ?? 0) + 1,
    value,
    clickAt: null,
    conversionAt,
    adjustmentAt,
    nextAttemptAt,
  }
}

/** gclid (plus gbraid when both exist, as Google recommends), else gbraid, else wbraid; never gbraid + wbraid. */
export function pickClickIds(c: ClickIds): ClickIds {
  if (c.gclid) return { gclid: c.gclid, ...(c.gbraid ? { gbraid: c.gbraid } : {}) }
  if (c.gbraid) return { gbraid: c.gbraid }
  if (c.wbraid) return { wbraid: c.wbraid }
  return {}
}

/** Google does not take retractions or restatements for wbraid conversions. */
export function canAdjust(c: ClickIds): boolean {
  return !!(c.gclid || c.gbraid)
}

/** Google's "yyyy-mm-dd hh:mm:ss+hh:mm" in the given time zone (the account's; India by default). */
export function formatAdsDateTime(d: Date, timeZone: string | null | undefined = 'Asia/Kolkata'): string {
  let parts: Record<string, string>
  try {
    parts = zoneParts(d, timeZone || 'Asia/Kolkata')
  } catch {
    parts = zoneParts(d, 'Asia/Kolkata')
  }
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  const offset = Math.round((wall - Math.floor(d.getTime() / 1000) * 1000) / 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const abs = Math.abs(offset)
  const tz = `${offset < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}${tz}`
}

function zoneParts(d: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]))
}

/** 30 min, 1 h, 2 h ... capped at a day. */
export function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000 * 2 ** Math.max(0, attempts - 1), DAY)
}

export type ErrorOutcome = 'retry' | 'failed' | 'skipped' | 'uploaded'

interface Rule {
  outcome: ErrorOutcome
  hours?: number
  reason: string
}

const CLICK_RULES: Record<string, Rule> = {
  TOO_RECENT_EVENT: { outcome: 'retry', hours: 6, reason: 'The click is less than 6 hours old; Google takes it after that.' },
  ORDER_ID_ALREADY_IN_USE: { outcome: 'uploaded', reason: 'Already recorded in Google Ads for this order.' },
  CLICK_CONVERSION_ALREADY_EXISTS: { outcome: 'uploaded', reason: 'Already recorded in Google Ads.' },
  EXPIRED_EVENT: { outcome: 'skipped', reason: "The click is older than the conversion action's click-through window." },
  CLICK_NOT_FOUND: { outcome: 'skipped', reason: 'Google could not match the click to an ad (usually not a Google Ads click).' },
  EVENT_NOT_FOUND: { outcome: 'skipped', reason: 'Google could not attribute the order to an ad click.' },
  INVALID_CUSTOMER_FOR_CLICK: { outcome: 'skipped', reason: 'The click came from a different Google Ads account.' },
  UNAUTHORIZED_CUSTOMER: { outcome: 'skipped', reason: 'The click came from a Google Ads account this connection cannot reach.' },
  CONVERSION_TRACKING_NOT_ENABLED_AT_IMPRESSION_TIME: { outcome: 'skipped', reason: 'Conversion tracking was off in Google Ads at click time.' },
  CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY: { outcome: 'skipped', reason: "Blocked by Apple's App Tracking Transparency rules." },
  CONVERSION_PRECEDES_EVENT: { outcome: 'skipped', reason: 'Google has the click after the order time.' },
  UNPARSEABLE_GCLID: { outcome: 'skipped', reason: 'Google could not read the gclid (it may have been altered).' },
  UNPARSEABLE_GBRAID: { outcome: 'skipped', reason: 'Google could not read the gbraid.' },
  UNPARSEABLE_WBRAID: { outcome: 'skipped', reason: 'Google could not read the wbraid.' },
}

const ADJUSTMENT_RULES: Record<string, Rule> = {
  TOO_RECENT_CONVERSION: { outcome: 'retry', hours: 24, reason: 'Google takes adjustments 24 hours after the conversion.' },
  CONVERSION_NOT_FOUND: { outcome: 'retry', hours: 6, reason: 'Google has not processed the purchase yet.' },
  CONVERSION_ALREADY_RETRACTED: { outcome: 'skipped', reason: 'Already retracted in Google Ads.' },
  MORE_RECENT_RESTATEMENT_FOUND: { outcome: 'skipped', reason: 'Google already has a newer value for this order.' },
  RESTATEMENT_ALREADY_EXISTS: { outcome: 'skipped', reason: 'Google already has this value for this order.' },
  CONVERSION_EXPIRED: { outcome: 'skipped', reason: 'Google only takes adjustments within 54 days of the conversion.' },
  TOO_MANY_ADJUSTMENTS: { outcome: 'skipped', reason: 'The conversion was already adjusted the maximum number of times.' },
}

const SHARED_RULES: Record<string, Rule> = {
  TOO_RECENT_CONVERSION_ACTION: { outcome: 'retry', hours: 6, reason: 'The conversion action is new; Google takes uploads about 6 hours after it is created.' },
  NO_CONVERSION_ACTION_FOUND: { outcome: 'failed', reason: 'The conversion action is missing or not enabled in this account. Pick another one.' },
  INVALID_CONVERSION_ACTION_TYPE: { outcome: 'failed', reason: 'The chosen conversion action is not an import (UPLOAD_CLICKS) action.' },
  CUSTOMER_NOT_ACCEPTED_CUSTOMER_DATA_TERMS: { outcome: 'failed', reason: 'Accept the customer data terms in Google Ads (Goals > Settings), then retry.' },
  CUSTOMER_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS: { outcome: 'failed', reason: 'Turn on enhanced conversions for leads in Google Ads (Goals > Settings), then retry.' },
  CANNOT_RESTATE_CONVERSION_ACTION_THAT_ALWAYS_USES_DEFAULT_CONVERSION_VALUE: { outcome: 'failed', reason: 'The conversion action always uses its default value, so values cannot be restated.' },
}

export interface Classified {
  outcome: ErrorOutcome
  /** Minimum wait before the next attempt (on top of the backoff). */
  delayMs: number
  message: string
}

/** How a row-level Google error code is handled for a click upload or an adjustment. */
export function classifyRowError(kind: ConversionKind, code: string, googleMessage = ''): Classified {
  const rule = (kind === 'purchase' ? CLICK_RULES : ADJUSTMENT_RULES)[code] ?? SHARED_RULES[code]
  const tail = code ? ` (${code})` : ''
  if (!rule) return { outcome: 'failed', delayMs: 0, message: `${googleMessage || 'Google rejected the upload'}${tail}` }
  return { outcome: rule.outcome, delayMs: (rule.hours ?? 0) * HOUR, message: `${rule.reason}${tail}` }
}

export const NOT_ALLOWLISTED = 'CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE'

/** Readable text for a request-level failure (the whole batch). */
export function requestErrorMessage(codes: string[], message: string): string {
  if (codes.includes(NOT_ALLOWLISTED)) {
    return (
      'Google refused the upload: since 15 June 2026 click-conversion uploads only work for developer tokens that ' +
      'uploaded offline conversions before that date, and new integrations must use the Data Manager API ' +
      `(${NOT_ALLOWLISTED}).`
    )
  }
  return message || 'Google Ads request failed'
}

/** Earliest moment an adjustment to this purchase is worth sending. */
export function adjustmentNotBefore(purchase: { conversion_at: Date | string; uploaded_at?: Date | string | null }): Date {
  const conv = toDate(purchase.conversion_at) ?? new Date(0)
  const up = toDate(purchase.uploaded_at)
  return latest(
    new Date(conv.getTime() + ADJUST_AFTER_CONVERSION_HOURS * HOUR),
    up ? new Date(up.getTime() + ADJUST_AFTER_UPLOAD_HOURS * HOUR) : null
  )
}

/** Data Manager: adjust once Google confirmed the purchase's request, else after its processing window. */
export function dmAdjustmentNotBefore(purchase: {
  conversion_at: Date | string
  uploaded_at?: Date | string | null
  request_id?: string | null
  request_status?: string | null
}): Date {
  if (!purchase.request_id) return adjustmentNotBefore(purchase)
  const up = toDate(purchase.uploaded_at) ?? new Date(0)
  if (purchase.request_status === 'SUCCESS' || purchase.request_status === 'PARTIAL_SUCCESS') return up
  return new Date(up.getTime() + DM_PROCESSING_HOURS * HOUR)
}

/** Wait before the next status read, after `checks` reads (Google's 30 min x1.3 backoff, capped at an hour). */
export function nextPollDelayMs(checks: number): number {
  return Math.round(Math.min(POLL_MAX_MIN, POLL_FIRST_MIN * POLL_MULTIPLIER ** Math.max(0, checks)) * 60_000)
}

// Data Manager processing errors (requestStatus:retrieve error counts), all event kinds.
const DM_PROCESSING_RULES: Record<string, Rule> = {
  PROCESSING_ERROR_REASON_TOO_RECENT_CLICK: { outcome: 'retry', hours: 6, reason: 'The click was too recent for Google; it is sent again later.' },
  PROCESSING_ERROR_REASON_DESTINATION_TOO_RECENTLY_CREATED: {
    outcome: 'retry',
    hours: 6,
    reason: 'The conversion action is new; Google takes uploads a few hours after it is created.',
  },
  PROCESSING_ERROR_REASON_INTERNAL_ERROR: { outcome: 'retry', hours: 1, reason: 'Google had an internal error; it is sent again.' },
  PROCESSING_ERROR_REASON_ORIGINAL_CONVERSIONS_NOT_FOUND: { outcome: 'retry', hours: 6, reason: 'Google has not processed the purchase yet.' },
  PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID: { outcome: 'uploaded', reason: 'Already recorded in Google Ads for this order.' },
  PROCESSING_ERROR_REASON_DUPLICATE_GCLID: { outcome: 'uploaded', reason: 'Already recorded in Google Ads for this click and time.' },
  PROCESSING_ERROR_REASON_EVENT_TOO_OLD: { outcome: 'skipped', reason: 'Older than Google accepts for a conversion.' },
  PROCESSING_ERROR_REASON_EXPIRED_CLICK: { outcome: 'skipped', reason: "The click is older than the conversion action's click-through window." },
  PROCESSING_ERROR_REASON_CLICK_NOT_FOUND: { outcome: 'skipped', reason: 'Google could not match the click to an ad (usually not a Google Ads click).' },
  PROCESSING_ERROR_REASON_INVALID_CLICK: { outcome: 'skipped', reason: 'The click is not from a Google Ads campaign.' },
  PROCESSING_ERROR_REASON_INVALID_GCLID: { outcome: 'skipped', reason: 'Google could not read the gclid (it may have been altered).' },
  PROCESSING_ERROR_REASON_INVALID_GBRAID: { outcome: 'skipped', reason: 'Google could not read the gbraid.' },
  PROCESSING_ERROR_REASON_INVALID_WBRAID: { outcome: 'skipped', reason: 'Google could not read the wbraid.' },
  PROCESSING_ERROR_REASON_INVALID_AD_IDENTIFIERS: { outcome: 'skipped', reason: 'Google could not read the click id.' },
  PROCESSING_ERROR_REASON_INVALID_OPERATING_ACCOUNT_FOR_CLICK: { outcome: 'skipped', reason: 'The click came from a different Google Ads account.' },
  PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER: { outcome: 'skipped', reason: 'The click came from a different Google Ads account.' },
  PROCESSING_ERROR_REASON_CONVERSION_PRECEDES_CLICK: { outcome: 'skipped', reason: 'Google has the click after the order time.' },
  PROCESSING_ERROR_REASON_DENIED_CONSENT: { outcome: 'skipped', reason: 'The buyer declined advertising cookies, so Google did not use it.' },
  PROCESSING_ERROR_REASON_UNKNOWN_CONSENT: {
    outcome: 'skipped',
    reason: 'Google could not tell whether the buyer consented to ad data (no cookie choice was recorded).',
  },
  PROCESSING_ERROR_REASON_NO_CONSENT: {
    outcome: 'failed',
    reason: 'Google Ads has no advertiser consent for its core services on this account. Check the consent settings in Google Ads.',
  },
  PROCESSING_ERROR_REASON_DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED: {
    outcome: 'failed',
    reason: 'Accept the customer data terms for enhanced conversions in Google Ads (Goals > Settings), then retry.',
  },
  PROCESSING_ERROR_REASON_ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID: {
    outcome: 'failed',
    reason: 'iOS (gbraid / wbraid) clicks need a conversion action that counts every conversion.',
  },
}

// Fast-fail field violations that point at one event; the rest of the request is sent again.
const DM_EVENT_RULES: Record<string, Rule> = {
  EVENT_TIME_INVALID: { outcome: 'skipped', reason: 'Google does not take a conversion with this time (outside its window).' },
  INVALID_AD_IDENTIFIER_FOR_ACCOUNT: { outcome: 'skipped', reason: 'The click came from a different Google Ads account.' },
  NO_IDENTIFIERS_PROVIDED: { outcome: 'skipped', reason: 'No click id or customer data to attribute it with.' },
  INVALID_CURRENCY_CODE: { outcome: 'failed', reason: 'Google does not accept the currency code.' },
}

const humanizeReason = (r: string) =>
  r
    .replace(/^PROCESSING_(ERROR|WARNING)_(REASON_)?/, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, c => c.toUpperCase())

/** How a Data Manager processing error reason is handled for the rows of the request. */
export function classifyProcessingError(reason: string): Classified {
  const rule = DM_PROCESSING_RULES[reason]
  const tail = reason ? ` (${reason})` : ''
  if (!rule) return { outcome: 'failed', delayMs: 0, message: `Google rejected it: ${humanizeReason(reason || 'unknown')}${tail}` }
  return { outcome: rule.outcome, delayMs: (rule.hours ?? 0) * HOUR, message: `${rule.reason}${tail}` }
}

/** How a fast-fail field violation on one event is handled for its row. */
export function classifyEventViolation(v: { reason: string; description?: string }): Classified {
  const rule = DM_EVENT_RULES[v.reason]
  const tail = v.reason ? ` (${v.reason})` : ''
  if (!rule) return { outcome: 'failed', delayMs: 0, message: `${v.description || 'Google rejected this event'}${tail}` }
  return { outcome: rule.outcome, delayMs: (rule.hours ?? 0) * HOUR, message: `${rule.reason}${tail}` }
}

/** Short text for request-level counts, e.g. "Expired click x2, Click not found x1". */
export function describeReasonCounts(counts: { reason: string; count: number }[]): string {
  return counts.map(c => `${humanizeReason(c.reason)} x${c.count}`).join(', ')
}

/** Problems with the connection or setup: the queue waits (no attempt used) until they are fixed. */
export const BLOCKING_CODES = new Set([
  'DATA_MANAGER_SCOPE_MISSING',
  'OAUTH_TOKEN_INVALID',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'SERVICE_DISABLED',
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'INVALID_CONVERSION_ACTION_ID',
  'INVALID_CONVERSION_ACTION_TYPE',
  'CONVERSION_ACTION_TOO_RECENTLY_CREATED',
  'INVALID_DESTINATION',
  'DESTINATION_ACCOUNT_TYPE_MISMATCH',
  'OPERATING_ACCOUNT_LOGIN_ACCOUNT_MISMATCH',
  'NOT_ALLOWLISTED',
  'TERMS_AND_CONDITIONS_NOT_SIGNED',
  'NOT_FOUND',
  'FAILED_PRECONDITION',
  'RESOURCE_EXHAUSTED',
])

/** Problems with the credentials themselves: a status read failing this way stops the run too. */
export const CREDENTIAL_CODES = new Set([
  'DATA_MANAGER_SCOPE_MISSING',
  'OAUTH_TOKEN_INVALID',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'SERVICE_DISABLED',
  'UNAUTHENTICATED',
])

/** Request-level rejections of the hashed email / phone: sent again without them. */
export const IDENTIFIER_BLOCKERS = new Set([
  'DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED',
  'DESTINATION_ACCOUNT_DATA_POLICY_PROHIBITS_ENHANCED_CONVERSIONS',
  'DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS',
])
