import { googleOAuthAccessToken, googleServiceAccountAccessToken } from '@/lib/integrations/resolve'

// Google Ads API REST client. Read paths (GAQL search/searchStream, listAccessibleCustomers) are
// used today; `post` is the generic customer-scoped call that conversion uploads
// (customers/{id}:uploadClickConversions) and mutates (googleAds:mutate) will build on.

export const GOOGLE_ADS_API_VERSION = 'v26'
export const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'
const DEFAULT_RETRY_DELAYS = [1000, 3000]

/** Customer ids are sent and stored as bare digits (Google displays them as 123-456-7890). */
export function normalizeCustomerId(id: string | number | null | undefined): string {
  return String(id ?? '').replace(/[^0-9]/g, '')
}

export function isValidCustomerId(id: string | null | undefined): boolean {
  return /^\d{10}$/.test(normalizeCustomerId(id))
}

export function formatCustomerId(id: string | null | undefined): string {
  const d = normalizeCustomerId(id)
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d
}

export interface ServiceAccountKey {
  clientEmail: string
  privateKey: string
}

export interface GoogleAdsClientOptions {
  /** OAuth refresh token (user sign-in); or a service account added as a user in Google Ads. */
  refreshToken?: string
  serviceAccount?: ServiceAccountKey
  customerId: string
  /** Manager (MCC) the credentials act through; sent as login-customer-id. */
  loginCustomerId?: string | null
  developerToken?: string
  fetchImpl?: typeof fetch
  retryDelays?: number[]
  /** Overridable for tests; defaults to the OAuth refresh or the service-account JWT grant. */
  getAccessToken?: () => Promise<{ token: string; expiresInSec: number }>
}

export interface AdsErrorDetail {
  code: string
  message: string
  /** Request field the error points at, e.g. "mutate_operations[3].ad_group_ad_operation.create.ad". */
  field?: string
}

const fieldPath = (loc: any): string | undefined =>
  (loc?.fieldPathElements ?? [])
    .map((p: any) => (p?.index != null ? `${p.fieldName}[${p.index}]` : p?.fieldName))
    .filter(Boolean)
    .join('.') || undefined

export class GoogleAdsApiError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
    public codes: string[],
    public requestId: string | null,
    public retryable: boolean,
    public details: AdsErrorDetail[] = []
  ) {
    super(message)
    this.name = 'GoogleAdsApiError'
  }
}

export class GoogleAdsNotConfiguredError extends Error {
  constructor(message = 'Google Ads is not configured: GOOGLE_ADS_DEVELOPER_TOKEN is not set') {
    super(message)
    this.name = 'GoogleAdsNotConfiguredError'
  }
}

// Readable explanations for the errors a store owner can act on. Keyed by the enum value in
// GoogleAdsFailure.errors[].errorCode.{category}.
const FRIENDLY: Record<string, string> = {
  DEVELOPER_TOKEN_NOT_APPROVED:
    'The Google Ads developer token only has test access, so it can only read test accounts. Apply for Basic or Standard access in the Google Ads API Center, or connect a test account.',
  DEVELOPER_TOKEN_PROHIBITED:
    'The developer token is not allowed for this OAuth client. Use the token from the manager account that owns the Google Cloud project.',
  DEVELOPER_TOKEN_INVALID: 'The Google Ads developer token is invalid. Check GOOGLE_ADS_DEVELOPER_TOKEN.',
  DEVELOPER_TOKEN_NOT_ON_ALLOWLIST: 'The developer token is not allow-listed for this feature.',
  USER_PERMISSION_DENIED:
    'The signed-in Google user cannot access this Google Ads account. If it is managed through a manager account, choose it under that manager (login customer id), or sign in with a user that has access.',
  CUSTOMER_NOT_ENABLED: 'This Google Ads account is not enabled (cancelled, suspended or never finished setup).',
  NOT_ADS_USER: 'This Google account is not linked to any Google Ads account.',
  OAUTH_TOKEN_INVALID: 'Google sign-in is no longer valid. Reconnect Google Ads.',
  OAUTH_TOKEN_EXPIRED: 'Google sign-in expired. Reconnect Google Ads.',
  OAUTH_TOKEN_REVOKED: 'Google access was revoked. Reconnect Google Ads.',
  TWO_STEP_VERIFICATION_NOT_ENROLLED: 'The signed-in Google user must turn on 2-Step Verification to use the Google Ads API.',
  ACTION_NOT_PERMITTED: 'The signed-in user does not have permission for this action in Google Ads.',
  INVALID_CUSTOMER_ID: 'That Google Ads customer id is invalid.',
  CUSTOMER_NOT_FOUND: 'No Google Ads account exists with that customer id.',
  RESOURCE_EXHAUSTED: 'Google Ads API quota for the developer token is used up for today. Try again later.',
  RESOURCE_TEMPORARILY_EXHAUSTED: 'Google Ads is rate limiting requests. Try again in a few minutes.',
  CREATION_DENIED_INELIGIBLE_MCC:
    'The platform manager account is not allowed to create accounts yet (Google requires a manager in good standing with enough spend). Link an existing account instead.',
  TOO_MANY_ACCOUNTS: 'The platform manager account has reached Google\'s limit on new accounts. Try again later or link an existing account.',
  TOO_MANY_ACCOUNTS_AT_MANAGER: 'The platform manager account manages the most accounts Google allows. Link an existing account instead.',
  REQUESTED_METRICS_FOR_MANAGER:
    'This is a manager account, which has no ads of its own. Pick one of the client accounts under it.',
}

const RETRYABLE_CODES = new Set(['RESOURCE_TEMPORARILY_EXHAUSTED', 'INTERNAL_ERROR', 'TRANSIENT_ERROR', 'DEADLINE_EXCEEDED'])

/** Pull the GoogleAdsFailure entries out of a REST error body ({error:{...}} or a bare status). */
export function parseAdsError(body: any, httpStatus: number): GoogleAdsApiError {
  const err = Array.isArray(body) ? body.find((b: any) => b?.error)?.error : (body?.error ?? body)
  const status: string = err?.status || ''
  const details: AdsErrorDetail[] = []
  let requestId: string | null = null
  for (const d of err?.details ?? []) {
    if (!String(d?.['@type'] || '').includes('GoogleAdsFailure')) continue
    requestId = d.requestId ?? requestId
    for (const e of d.errors ?? []) {
      const codeObj = e?.errorCode ?? {}
      const code = String(Object.values(codeObj)[0] ?? 'UNKNOWN')
      details.push({ code, message: String(e?.message ?? ''), field: fieldPath(e?.location) })
    }
  }
  const codes = details.map(d => d.code)
  if (!codes.length && status) codes.push(status)
  const friendly = codes.map(c => FRIENDLY[c]).find(Boolean)
  const raw = details[0]?.message || err?.message || `Google Ads request failed (HTTP ${httpStatus})`
  const message = friendly
    ? `${friendly} (${codes[0]})`
    : `${raw}${codes[0] && !raw.includes(codes[0]) ? ` (${codes[0]})` : ''}`
  const retryable =
    httpStatus === 429 || httpStatus >= 500 || status === 'UNAVAILABLE' || codes.some(c => RETRYABLE_CODES.has(c))
  return new GoogleAdsApiError(message, httpStatus, codes, requestId, retryable, details)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export type AdsRow = Record<string, any>

export class GoogleAdsClient {
  readonly customerId: string
  readonly loginCustomerId: string | null
  private readonly auth: Pick<GoogleAdsClientOptions, 'refreshToken' | 'serviceAccount'>
  private readonly developerToken: string
  private readonly fetchImpl: typeof fetch
  private readonly retryDelays: number[]
  private readonly getAccessToken: NonNullable<GoogleAdsClientOptions['getAccessToken']>
  private token: { value: string; expiresAt: number } | null = null

  constructor(opts: GoogleAdsClientOptions) {
    const devToken = opts.developerToken ?? process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    if (!devToken) throw new GoogleAdsNotConfiguredError()
    if (!opts.refreshToken && !opts.serviceAccount && !opts.getAccessToken) {
      throw new Error('Google Ads needs a refresh token or a service account')
    }
    this.developerToken = devToken
    this.auth = { refreshToken: opts.refreshToken, serviceAccount: opts.serviceAccount }
    this.customerId = normalizeCustomerId(opts.customerId)
    const login = normalizeCustomerId(opts.loginCustomerId)
    this.loginCustomerId = login && login !== this.customerId ? login : null
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a))
    this.retryDelays = opts.retryDelays ?? DEFAULT_RETRY_DELAYS
    const { refreshToken, serviceAccount } = this.auth
    this.getAccessToken =
      opts.getAccessToken ??
      (serviceAccount
        ? () => googleServiceAccountAccessToken(serviceAccount.clientEmail, serviceAccount.privateKey, GOOGLE_ADS_SCOPE)
        : () => googleOAuthAccessToken(refreshToken!, 'Google Ads'))
  }

  /** A client for another customer reached with the same credentials (e.g. a manager's client). */
  forCustomer(customerId: string, loginCustomerId?: string | null): GoogleAdsClient {
    const c = new GoogleAdsClient({
      ...this.auth,
      customerId,
      loginCustomerId: loginCustomerId === undefined ? this.loginCustomerId : loginCustomerId,
      developerToken: this.developerToken,
      fetchImpl: this.fetchImpl,
      retryDelays: this.retryDelays,
      getAccessToken: this.getAccessToken,
    })
    c.token = this.token
    return c
  }

  /** Same credentials and token with other retry delays (none for non-idempotent mutates). */
  withRetryDelays(retryDelays: number[]): GoogleAdsClient {
    const c = new GoogleAdsClient({
      ...this.auth,
      customerId: this.customerId,
      loginCustomerId: this.loginCustomerId,
      developerToken: this.developerToken,
      fetchImpl: this.fetchImpl,
      retryDelays,
      getAccessToken: this.getAccessToken,
    })
    c.token = this.token
    return c
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value
    const { token, expiresInSec } = await this.getAccessToken()
    this.token = { value: token, expiresAt: Date.now() + expiresInSec * 1000 }
    return token
  }

  async headers(withLogin = true): Promise<Record<string, string>> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
    }
    if (withLogin && this.loginCustomerId) h['login-customer-id'] = this.loginCustomerId
    return h
  }

  /** Raw request with retries on 429/5xx/transient quota errors. `path` is relative to the version root. */
  async request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown, withLogin = true): Promise<T> {
    let attempt = 0
    for (;;) {
      const res = await this.fetchImpl(`${GOOGLE_ADS_BASE}${path}`, {
        method,
        headers: await this.headers(withLogin),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let data: any = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = { error: { message: text.slice(0, 300) } }
      }
      // searchStream can return 200 with an error element after partial batches.
      const streamErr = Array.isArray(data) ? data.find((b: any) => b?.error) : null
      if (res.ok && !streamErr) return data as T
      const err = parseAdsError(data, res.ok ? 500 : res.status)
      if (!err.retryable || attempt >= this.retryDelays.length) throw err
      await sleep(this.retryDelays[attempt++])
    }
  }

  /** POST under this customer: `post(':uploadClickConversions', body)` or `post('/googleAds:mutate', body)`. */
  post<T = any>(suffix: string, body: unknown): Promise<T> {
    return this.request<T>('POST', `/customers/${this.customerId}${suffix}`, body)
  }

  /** GAQL via searchStream: every batch flattened into one row list. */
  async searchStream(query: string): Promise<AdsRow[]> {
    const batches = await this.post<any[]>('/googleAds:searchStream', { query })
    const rows: AdsRow[] = []
    for (const b of Array.isArray(batches) ? batches : [batches]) for (const r of b?.results ?? []) rows.push(r)
    return rows
  }

  /** GAQL via paged search, following nextPageToken. `maxPages` bounds runaway reads. */
  async search(query: string, maxPages = 50): Promise<AdsRow[]> {
    const rows: AdsRow[] = []
    let pageToken: string | undefined
    for (let page = 0; page < maxPages; page++) {
      const res = await this.post<any>('/googleAds:search', pageToken ? { query, pageToken } : { query })
      for (const r of res?.results ?? []) rows.push(r)
      pageToken = res?.nextPageToken
      if (!pageToken) break
    }
    return rows
  }

  /** Customer ids the OAuth user can access directly (no login-customer-id). */
  async listAccessibleCustomers(): Promise<string[]> {
    const res = await this.request<{ resourceNames?: string[] }>('GET', '/customers:listAccessibleCustomers', undefined, false)
    return (res?.resourceNames ?? []).map(n => normalizeCustomerId(n.split('/').pop()))
  }
}

/** Micros (1/1,000,000 of the account currency) to currency units. */
export function fromMicros(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n / 1_000_000 : 0
}
