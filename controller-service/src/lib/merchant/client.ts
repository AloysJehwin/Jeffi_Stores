import { createHash, createSign } from 'crypto'
import { resolveGoogleMerchantCreds, googleOAuthAccessToken } from '@/lib/integrations/resolve'
import { CONTENT_LANGUAGE, FEED_LABEL } from './mapper'

// When true (set on local dev), pushes to Google Merchant Center are refused so
// local never writes to the real Merchant Center (there is no test GMC account).
export const GMC_PUSH_DISABLED = process.env.GMC_PUSH_DISABLED === 'true'
const SCOPE = 'https://www.googleapis.com/auth/content'
// Merchant API v1 (the Content API for Shopping v2.1 is shut down).
export const MERCHANT_API = 'https://merchantapi.googleapis.com'
export { CONTENT_LANGUAGE, FEED_LABEL }
export const DATA_SOURCE_DISPLAY_NAME = 'Jeffi Stores API'

// Merchant id is resolved per-tenant at call time (tenant's own account when in a tenant
// context, else Jeffi's env fallback).
export async function getMerchantId(): Promise<string> {
  return (await resolveGoogleMerchantCreds()).merchantId
}

// Non-throwing connection check. resolveGoogleMerchantCreds() throws for an unconnected tenant
// rather than silently using Jeffi's env service account, so callers that must SKIP cleanly when
// Google Merchant is not connected use this instead of a bare getMerchantId() guard.
export async function merchantConfigured(): Promise<boolean> {
  try {
    return !!(await getMerchantId())
  } catch {
    return false
  }
}

// Token cache is keyed by a fingerprint of the resolved creds (clientEmail+merchantId), never a
// single global — otherwise one tenant's token would be served to another. With no tenant in
// context the env creds produce one stable key, so Jeffi's behavior is unchanged.
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function getAccessToken(): Promise<string> {
  const creds = await resolveGoogleMerchantCreds()
  const cacheKey = creds.refreshToken
    ? `oauth|${createHash('sha256').update(creds.refreshToken).digest('hex')}|${creds.merchantId}`
    : `${creds.clientEmail}|${creds.merchantId}`
  const cached = tokenCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached.token
  }

  // Connected with Google sign-in: refresh the stored token instead of signing a JWT.
  if (creds.refreshToken) {
    const { token, expiresInSec } = await googleOAuthAccessToken(creds.refreshToken, 'Google Merchant')
    tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresInSec * 1000 })
    return token
  }

  const now = Math.floor(Date.now() / 1000)

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url')

  const signer = createSign('RSA-SHA256')
  signer.update(header + '.' + payload)
  const sig = signer.sign(creds.privateKey).toString('base64url')
  const jwt = header + '.' + payload + '.' + sig

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('GMC auth failed: ' + JSON.stringify(data))
  }

  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token
}

export class GmcApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'GmcApiError'
  }
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])
export const RETRY_DELAYS_MS = [2000, 5000]

// Authenticated Merchant API call. 429/5xx are retried with backoff; other failures throw GmcApiError
// carrying Google's message. `allow404` returns null instead of throwing for a missing resource.
export async function merchantApiRequest(
  method: string,
  path: string,
  opts: { body?: unknown; delays?: number[]; allow404?: boolean } = {}
): Promise<any> {
  const delays = opts.delays ?? RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken()
    const res = await fetch(`${MERCHANT_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    })
    if (res.ok) return res.status === 204 ? {} : res.json().catch(() => ({}))
    if (res.status === 404 && opts.allow404) return null
    const err = await res.text()
    if (RETRY_STATUSES.has(res.status) && attempt < delays.length) {
      await new Promise(r => setTimeout(r, delays[attempt]))
      continue
    }
    const creds = await resolveGoogleMerchantCreds().catch(() => null)
    throw new GmcApiError(res.status, gmcErrorMessage(res.status, err, creds))
  }
}

// Google's error bodies are JSON ({error:{code,message}}); keep just the message so logs stay readable.
export function gmcErrorMessage(
  status: number,
  body: string,
  creds?: { clientEmail?: string; merchantId?: string; refreshToken?: string } | null
): string {
  let msg = body
  try {
    const parsed = JSON.parse(body)
    msg = parsed?.error?.message || parsed?.message || body
  } catch {}
  msg = String(msg).replace(/\s+/g, ' ').trim().slice(0, 300)
  if (status === 401 || status === 403) {
    const account = creds?.merchantId ? ` ${creds.merchantId}` : ''
    if (/API_DEVELOPER/.test(msg)) {
      return (
        `HTTP ${status}: Merchant API sync needs an API developer on Merchant Center account${account}. Open the gear ` +
        `(top right), then "Enable Merchant API sync" with the email of an admin on that account.`
      )
    }
    if (/not registered with the merchant account/i.test(msg)) {
      return (
        `HTTP ${status}: Merchant API sync is not enabled for this Merchant Center account yet. Open the gear ` +
        `(top right), then "Enable Merchant API sync" (or reconnect with Google, which enables it). Google only allows ` +
        `this for an account with a verified website, by a Google account that is an admin on it.`
      )
    }
    if (creds?.refreshToken) {
      return (
        `HTTP ${status}: ${msg} — the Google account you connected has no access to Merchant Center account${account}. ` +
        `Reconnect with a Google account that is an Admin on it (Merchant Center > Settings > People and access).`
      )
    }
    const who = creds?.clientEmail ? `the service account ${creds.clientEmail}` : 'the service account'
    return (
      `HTTP ${status}: ${msg} — ${who} has no access to Merchant Center account${account}. ` +
      `Add it under Merchant Center > Settings > People and access (Admin).`
    )
  }
  if (status === 410) {
    return `Google has shut down this API version (HTTP 410). ${msg}`.trim()
  }
  return `HTTP ${status}: ${msg}`
}

function accountPath(merchantId: string): string {
  return `accounts/${merchantId}`
}

// Product input / product resource id: base64url (unpadded) of contentLanguage~feedLabel~offerId,
// so offer ids with '/', '%' or '~' stay valid in the path.
export function productResourceId(offerId: string): string {
  return Buffer.from(`${CONTENT_LANGUAGE}~${FEED_LABEL}~${offerId}`, 'utf8').toString('base64url')
}

// --- Data source -----------------------------------------------------------------------------

const dataSourceCache = new Map<string, string>()

function normalizeDataSource(merchantId: string, value: string): string {
  const v = value.trim()
  return v.startsWith('accounts/') ? v : `${accountPath(merchantId)}/dataSources/${v}`
}

function isUsableApiSource(ds: any): boolean {
  const p = ds?.primaryProductDataSource
  if (ds?.input !== 'API' || !p) return false
  // Unset feedLabel/contentLanguage accept any; set ones must match what we send.
  return (!p.feedLabel || p.feedLabel === FEED_LABEL) && (!p.contentLanguage || p.contentLanguage === CONTENT_LANGUAGE)
}

/**
 * Primary API data source products are inserted into: the configured one (GMC_DATA_SOURCE or the
 * tenant's data_source), else an existing primary API source, else one created for the store.
 */
export async function resolveDataSource(): Promise<string> {
  const creds = await resolveGoogleMerchantCreds()
  if (creds.dataSource) return normalizeDataSource(creds.merchantId, creds.dataSource)
  const cached = dataSourceCache.get(creds.merchantId)
  if (cached) return cached

  const base = `/datasources/v1/${accountPath(creds.merchantId)}/dataSources`
  try {
    const found: any[] = []
    let pageToken: string | undefined
    do {
      const qs = new URLSearchParams({ pageSize: '1000' })
      if (pageToken) qs.set('pageToken', pageToken)
      const res = await merchantApiRequest('GET', `${base}?${qs}`)
      found.push(...(res?.dataSources || []).filter(isUsableApiSource))
      pageToken = res?.nextPageToken
    } while (pageToken)

    let name: string | undefined =
      (found.find(ds => ds.displayName === DATA_SOURCE_DISPLAY_NAME) || found[0])?.name
    if (!name) {
      const created = await merchantApiRequest('POST', base, {
        body: {
          displayName: DATA_SOURCE_DISPLAY_NAME,
          primaryProductDataSource: { contentLanguage: CONTENT_LANGUAGE, feedLabel: FEED_LABEL, countries: ['IN'] },
        },
      })
      name = created?.name
    }
    if (!name) throw new Error('Google returned no data source name')
    dataSourceCache.set(creds.merchantId, name)
    return name
  } catch (err: any) {
    throw new Error(`Could not find or create the Merchant API data source: ${err?.message || err}`)
  }
}

export function clearDataSourceCache(): void {
  dataSourceCache.clear()
}

// --- Products --------------------------------------------------------------------------------

/** Insert (or replace) a ProductInput in the store's API data source. */
export async function insertProductInput(input: unknown, opts: { dataSource?: string; delays?: number[] } = {}) {
  const merchantId = await getMerchantId()
  const dataSource = opts.dataSource ?? (await resolveDataSource())
  const qs = new URLSearchParams({ dataSource })
  return merchantApiRequest('POST', `/products/v1/${accountPath(merchantId)}/productInputs:insert?${qs}`, {
    body: input,
    delays: opts.delays,
  })
}

export const upsertProduct = (input: unknown) => insertProductInput(input)

/** Remove our product input; a product already gone (404) is not an error. */
export async function deleteProductByOfferId(offerId: string, dataSource?: string): Promise<void> {
  const merchantId = await getMerchantId()
  const qs = new URLSearchParams({ dataSource: dataSource ?? (await resolveDataSource()) })
  await merchantApiRequest(
    'DELETE',
    `/products/v1/${accountPath(merchantId)}/productInputs/${productResourceId(offerId)}?${qs}`,
    { allow404: true }
  )
}

/** Processed products (all data sources) with productStatus. */
export async function listProducts(pageToken?: string): Promise<{ products?: any[]; nextPageToken?: string }> {
  const merchantId = await getMerchantId()
  const qs = new URLSearchParams({ pageSize: '1000' })
  if (pageToken) qs.set('pageToken', pageToken)
  return merchantApiRequest('GET', `/products/v1/${accountPath(merchantId)}/products?${qs}`)
}

/** One processed product with its status, or null when Google has no such product. */
export async function getProduct(offerId: string): Promise<any | null> {
  const merchantId = await getMerchantId()
  return merchantApiRequest('GET', `/products/v1/${accountPath(merchantId)}/products/${productResourceId(offerId)}`, {
    allow404: true,
  })
}
