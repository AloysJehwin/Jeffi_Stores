import { googleOAuthAccessToken, googleServiceAccountAccessToken } from '@/lib/integrations/resolve'
import { normalizeCustomerId, type ServiceAccountKey } from '../client'
import type { GoogleAdsCreds } from '../credentials'

// Data Manager API (datamanager.googleapis.com/v1): events:ingest sends conversions and value
// adjustments, requestStatus:retrieve reads Google's processing result. No developer token; the
// token needs the datamanager scope. Fast-fail: one invalid event fails the whole request and
// nothing in it is ingested; processing errors come later, as counts per request.

export const DATA_MANAGER_BASE = 'https://datamanager.googleapis.com/v1'
export const DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager'
/** Ours, not Google's: the token was granted without the datamanager scope. */
export const SCOPE_MISSING = 'DATA_MANAGER_SCOPE_MISSING'
/** Ours: the refresh token was revoked or expired (invalid_grant). */
export const TOKEN_INVALID = 'OAUTH_TOKEN_INVALID'
/** Per request, events and destinations. */
export const MAX_EVENTS_PER_REQUEST = 2000
const DEFAULT_RETRY_DELAYS = [1000, 3000]

export const hasDataManagerScope = (scope: string | string[] | null | undefined) =>
  (Array.isArray(scope) ? scope : String(scope ?? '').split(/\s+/)).includes(DATA_MANAGER_SCOPE)

export interface FieldViolation {
  field: string
  reason: string
  description: string
}

export interface FieldWarning {
  field: string
  reason: string
  description: string
}

export class DataManagerApiError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
    /** Canonical status: INVALID_ARGUMENT, PERMISSION_DENIED, RESOURCE_EXHAUSTED ... */
    public status: string,
    /** ErrorInfo.reason (SERVICE_DISABLED, ACCESS_TOKEN_SCOPE_INSUFFICIENT, RATE_LIMIT_EXCEEDED ...) or ours. */
    public reason: string | null,
    public requestId: string | null,
    public violations: FieldViolation[],
    public retryable: boolean,
    /** ErrorInfo.metadata.quota_limit on 429s, e.g. IngestionMutateRequestsPerDayPerProject. */
    public quotaLimit: string | null = null
  ) {
    super(message)
    this.name = 'DataManagerApiError'
  }

  /** The most specific code: a field violation's reason, else ErrorInfo.reason, else the status. */
  get code(): string {
    return this.violations[0]?.reason || this.reason || this.status || 'UNKNOWN'
  }
}

const RECONNECT =
  'The Google sign-in does not allow conversion uploads (Data Manager API) yet. Reconnect Google Ads and allow it on the Google consent screen.'

// What a store owner can act on, by field-violation reason, ErrorInfo reason or status.
const FRIENDLY: Record<string, string> = {
  [SCOPE_MISSING]: RECONNECT,
  ACCESS_TOKEN_SCOPE_INSUFFICIENT: RECONNECT,
  [TOKEN_INVALID]: 'Google sign-in is no longer valid. Reconnect Google Ads.',
  UNAUTHENTICATED: 'Google sign-in is no longer valid. Reconnect Google Ads.',
  SERVICE_DISABLED:
    "The Data Manager API is not enabled in the platform's Google Cloud project. Enable datamanager.googleapis.com there, then retry.",
  PERMISSION_DENIED:
    'The connected Google user (or service account) cannot send conversions to this Google Ads account. It needs Standard or Admin access to the account that owns the conversion action.',
  INVALID_CONVERSION_ACTION_ID: 'Google does not know the chosen conversion action. Pick another one on this tab.',
  INVALID_CONVERSION_ACTION_TYPE: 'The chosen conversion action is not an import (Website, import from clicks) action.',
  CONVERSION_ACTION_TOO_RECENTLY_CREATED: 'The conversion action is new; Google takes uploads a few hours after it is created.',
  INVALID_DESTINATION: 'Google rejected the Google Ads account or conversion action. Choose the conversion action again.',
  OPERATING_ACCOUNT_LOGIN_ACCOUNT_MISMATCH: 'Google rejected the manager account this connection goes through. Reconnect Google Ads.',
  DESTINATION_ACCOUNT_TYPE_MISMATCH: 'Google says the account id is not a Google Ads account.',
  NOT_ALLOWLISTED: 'This Google Ads account is not allowed to use this feature.',
  TERMS_AND_CONDITIONS_NOT_SIGNED: 'Accept the required terms in Google Ads, then retry.',
  DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED:
    'The customer data terms for enhanced conversions are not accepted in Google Ads (Goals > Settings).',
  DESTINATION_ACCOUNT_DATA_POLICY_PROHIBITS_ENHANCED_CONVERSIONS:
    'Google customer data policies do not allow enhanced conversions for this account.',
  DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS:
    'Enhanced conversions for leads is off in Google Ads (Goals > Settings).',
  RESOURCE_EXHAUSTED: 'The Data Manager API quota is used up for now. Uploads resume automatically.',
}

export function friendlyDataManagerMessage(code: string, fallback = ''): string {
  return FRIENDLY[code] ?? fallback
}

const RETRYABLE_STATUS = new Set(['UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED', 'UNKNOWN', 'ABORTED'])

/** A REST error body ({error:{code,status,message,details}}) as a DataManagerApiError. */
export function parseDataManagerError(body: any, httpStatus: number): DataManagerApiError {
  const err = body?.error ?? body ?? {}
  const status = String(err?.status || '')
  let reason: string | null = null
  let requestId: string | null = null
  let quotaLimit: string | null = null
  const violations: FieldViolation[] = []
  for (const d of Array.isArray(err?.details) ? err.details : []) {
    const type = String(d?.['@type'] ?? '')
    if (type.endsWith('google.rpc.ErrorInfo')) {
      reason = d?.reason ? String(d.reason) : reason
      requestId = d?.metadata?.requestId ?? requestId
      quotaLimit = d?.metadata?.quota_limit ?? quotaLimit
    } else if (type.endsWith('google.rpc.RequestInfo')) {
      requestId = d?.requestId ?? requestId
    } else if (type.endsWith('google.rpc.BadRequest')) {
      for (const v of Array.isArray(d?.fieldViolations) ? d.fieldViolations : []) {
        violations.push({ field: String(v?.field ?? ''), reason: String(v?.reason ?? ''), description: String(v?.description ?? '') })
      }
    }
  }
  // INVALID_ARGUMENT duplicates the canonical status in ErrorInfo; the violations say more.
  if (reason === status) reason = null
  const daily = /PerDay/i.test(quotaLimit ?? '')
  const retryable =
    !daily &&
    (httpStatus >= 500 ||
      RETRYABLE_STATUS.has(status) ||
      (httpStatus === 429 && (!status || status === 'RESOURCE_EXHAUSTED')))
  const e = new DataManagerApiError('', httpStatus, status || `HTTP_${httpStatus}`, reason, requestId, violations, retryable, quotaLimit)
  const raw = violations[0]?.description || String(err?.message || '') || `Data Manager API request failed (HTTP ${httpStatus})`
  const code = e.code
  const friendly = FRIENDLY[code] ?? (reason ? FRIENDLY[reason] : undefined) ?? FRIENDLY[e.status]
  e.message = friendly ? `${friendly} (${code})` : `${raw}${code && !raw.includes(code) ? ` (${code})` : ''}`
  return e
}

/** Index of the event a field path points at ("events.events[3].user_data" -> 3), else null. */
export function eventIndex(field: string): number | null {
  const m = /^events(?:\.events)?\[(\d+)\]/.exec(field)
  return m ? Number(m[1]) : null
}

/** Fast-fail violations by event index, or null unless every one of them names an event in the batch. */
export function violationsByEvent(violations: FieldViolation[], count: number): Map<number, FieldViolation[]> | null {
  if (!violations.length) return null
  const out = new Map<number, FieldViolation[]>()
  for (const v of violations) {
    const i = eventIndex(v.field)
    if (i == null || i >= count) return null
    out.set(i, [...(out.get(i) ?? []), v])
  }
  return out
}

export interface AdsDestination {
  operatingAccount: { accountType: 'GOOGLE_ADS'; accountId: string }
  loginAccount?: { accountType: 'GOOGLE_ADS'; accountId: string }
  productDestinationId: string
}

/**
 * The conversion action's owner is the operating account (Google requires the conversion customer,
 * not a parent or child); the login account is the manager the credentials act through, if any.
 */
export function adsDestination(d: { operating: string; login?: string | null; actionId: string }): AdsDestination {
  const operating = normalizeCustomerId(d.operating)
  const login = normalizeCustomerId(d.login)
  return {
    operatingAccount: { accountType: 'GOOGLE_ADS', accountId: operating },
    ...(login && login !== operating ? { loginAccount: { accountType: 'GOOGLE_ADS' as const, accountId: login } } : {}),
    productDestinationId: String(d.actionId),
  }
}

export type ConsentStatus = 'CONSENT_GRANTED' | 'CONSENT_DENIED'

export interface IngestEvent {
  transactionId: string
  eventTimestamp: string
  lastUpdatedTimestamp?: string
  eventSource: 'WEB'
  conversionValue: number
  currency: string
  adIdentifiers: { gclid?: string; gbraid?: string; wbraid?: string }
  consent?: { adUserData: ConsentStatus; adPersonalization: ConsentStatus }
  userData?: { userIdentifiers: ({ emailAddress: string } | { phoneNumber: string })[] }
}

export interface IngestEventsRequest {
  destinations: AdsDestination[]
  events: IngestEvent[]
  encoding: 'HEX'
  validateOnly?: boolean
}

export interface IngestEventsResponse {
  requestId?: string
  fieldWarnings?: FieldWarning[]
}

export interface ReasonCountRaw {
  recordCount?: string | number
  reason?: string
}

export interface RequestStatusPerDestination {
  destination?: unknown
  requestStatus?: string
  errorInfo?: { errorCounts?: ReasonCountRaw[] }
  warningInfo?: { warningCounts?: ReasonCountRaw[] }
  eventsIngestionStatus?: { recordCount?: string | number }
}

export interface RetrieveRequestStatusResponse {
  requestStatusPerDestination?: RequestStatusPerDestination[]
}

export interface DataManagerClientOptions {
  refreshToken?: string
  serviceAccount?: ServiceAccountKey
  fetchImpl?: typeof fetch
  retryDelays?: number[]
  /** Overridable for tests; defaults to the OAuth refresh or the service-account JWT grant. */
  getAccessToken?: () => Promise<{ token: string; expiresInSec: number; scope?: string }>
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class DataManagerClient {
  private readonly fetchImpl: typeof fetch
  private readonly retryDelays: number[]
  private readonly getAccessToken: NonNullable<DataManagerClientOptions['getAccessToken']>
  private token: { value: string; expiresAt: number } | null = null

  constructor(opts: DataManagerClientOptions) {
    if (!opts.refreshToken && !opts.serviceAccount && !opts.getAccessToken) {
      throw new Error('The Data Manager API needs a refresh token or a service account')
    }
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a))
    this.retryDelays = opts.retryDelays ?? DEFAULT_RETRY_DELAYS
    const { refreshToken, serviceAccount } = opts
    this.getAccessToken =
      opts.getAccessToken ??
      (serviceAccount
        ? () => googleServiceAccountAccessToken(serviceAccount.clientEmail, serviceAccount.privateKey, DATA_MANAGER_SCOPE)
        : () => googleOAuthAccessToken(refreshToken!, 'Google Ads'))
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value
    let t: { token: string; expiresInSec: number; scope?: string }
    try {
      t = await this.getAccessToken()
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      if (!/invalid_grant/i.test(msg)) throw e
      throw new DataManagerApiError(`${FRIENDLY[TOKEN_INVALID]} (${TOKEN_INVALID})`, 401, 'UNAUTHENTICATED', TOKEN_INVALID, null, [], false)
    }
    // Google lists the granted scopes on a refresh; a token from an older sign-in lacks datamanager.
    if (t.scope != null && !hasDataManagerScope(t.scope)) {
      throw new DataManagerApiError(`${RECONNECT} (${SCOPE_MISSING})`, 403, 'PERMISSION_DENIED', SCOPE_MISSING, null, [], false)
    }
    this.token = { value: t.token, expiresAt: Date.now() + t.expiresInSec * 1000 }
    return t.token
  }

  /** One call with retries on transient errors and per-minute rate limits (not daily quota). */
  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let attempt = 0
    for (;;) {
      const res = await this.fetchImpl(`${DATA_MANAGER_BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let data: any = null
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { error: { message: text.slice(0, 300) } }
      }
      if (res.ok) return data as T
      const err = parseDataManagerError(data, res.status)
      if (!err.retryable || attempt >= this.retryDelays.length) throw err
      await sleep(this.retryDelays[attempt++])
    }
  }

  /** events:ingest. Resending a transaction id is safe: Google treats it as an adjustment. */
  ingestEvents(body: IngestEventsRequest): Promise<IngestEventsResponse> {
    return this.request<IngestEventsResponse>('POST', '/events:ingest', body)
  }

  /** Google's processing status for one successful, non-validate-only ingest request. */
  retrieveRequestStatus(requestId: string): Promise<RetrieveRequestStatusResponse> {
    return this.request<RetrieveRequestStatusResponse>('GET', `/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`)
  }
}

/** A client on the same credentials as the Google Ads connection (refresh token or service account). */
export function dataManagerClientFor(
  creds: Pick<GoogleAdsCreds, 'refreshToken' | 'serviceAccount'>,
  extra: Partial<DataManagerClientOptions> = {}
): DataManagerClient {
  return new DataManagerClient({ refreshToken: creds.refreshToken, serviceAccount: creds.serviceAccount, ...extra })
}
