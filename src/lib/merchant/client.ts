import { createSign } from 'crypto'
import { resolveGoogleMerchantCreds } from '@/lib/integrations/resolve'

// When true (set on local dev), pushes to Google Merchant Center are refused so
// local never writes to the real Merchant Center (there is no test GMC account).
export const GMC_PUSH_DISABLED = process.env.GMC_PUSH_DISABLED === 'true'
const SCOPE = 'https://www.googleapis.com/auth/content'
const BATCH_URL = `https://shoppingcontent.googleapis.com/content/v2.1`
const CHANNEL = 'online'
const CONTENT_LANGUAGE = 'en'
const TARGET_COUNTRY = 'IN'

export { CHANNEL, CONTENT_LANGUAGE, TARGET_COUNTRY }

// Merchant id is resolved per-tenant at call time (tenant's own account when in a tenant
// context, else Jeffi's env fallback). Callers building batch entries use this to keep the
// posted merchantId in sync with the account getAccessToken() authenticated against.
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

function baseUrl(merchantId: string): string {
  return `https://shoppingcontent.googleapis.com/content/v2.1/${merchantId}`
}

// Token cache is keyed by a fingerprint of the resolved creds (clientEmail+merchantId), never a
// single global — otherwise one tenant's token would be served to another. With no tenant in
// context the env creds produce one stable key, so Jeffi's behavior is unchanged.
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function getAccessToken(): Promise<string> {
  const creds = await resolveGoogleMerchantCreds()
  const cacheKey = `${creds.clientEmail}|${creds.merchantId}`
  const cached = tokenCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached.token
  }

  const now = Math.floor(Date.now() / 1000)

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: creds.clientEmail,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url')

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

export async function gmcRequest(method: string, path: string, body?: unknown): Promise<any> {
  const creds = await resolveGoogleMerchantCreds()
  const token = await getAccessToken()
  const res = await fetch(`${baseUrl(creds.merchantId)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GMC ${method} ${path} failed (${res.status}): ${err}`)
  }

  return res.json()
}

export async function upsertProduct(item: unknown): Promise<any> {
  return gmcRequest('POST', '/products', item)
}

export async function deleteProduct(productId: string): Promise<void> {
  const creds = await resolveGoogleMerchantCreds()
  const token = await getAccessToken()
  const res = await fetch(`${baseUrl(creds.merchantId)}/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    const err = await res.text()
    throw new Error(`GMC DELETE failed (${res.status}): ${err}`)
  }
}

export async function deleteProductByOfferId(offerId: string): Promise<void> {
  await deleteProduct(`${CHANNEL}:${CONTENT_LANGUAGE}:${TARGET_COUNTRY}:${offerId}`)
}

export async function listProducts(pageToken?: string): Promise<{ resources?: any[]; nextPageToken?: string }> {
  const qs = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''
  return gmcRequest('GET', `/products${qs}`)
}

export async function listProductStatuses(pageToken?: string): Promise<{ resources?: any[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ maxResults: '250' })
  if (pageToken) params.set('pageToken', pageToken)
  return gmcRequest('GET', `/productstatuses?${params.toString()}`)
}

export async function customBatchUpsert(entries: unknown[]): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`${BATCH_URL}/products/batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entries }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GMC POST /products/batch failed (${res.status}): ${err}`)
  }

  return res.json()
}
