import { createSign } from 'crypto'

const MERCHANT_ID = '5762156822'
const SCOPE = 'https://www.googleapis.com/auth/content'
const BASE_URL = `https://shoppingcontent.googleapis.com/content/v2.1/${MERCHANT_ID}`
const BATCH_URL = `https://shoppingcontent.googleapis.com/content/v2.1`
const CHANNEL = 'online'
const CONTENT_LANGUAGE = 'en'
const TARGET_COUNTRY = 'IN'

export { MERCHANT_ID, CHANNEL, CONTENT_LANGUAGE, TARGET_COUNTRY }

interface ServiceAccountCreds {
  client_email: string
  private_key: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function loadCredentials(): ServiceAccountCreds {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    return { client_email: creds.client_email, private_key: creds.private_key }
  }
  const fs = require('fs')
  const path = require('path')
  const credPath = path.join(process.cwd(), 'jeffi-stores-76e9ecaecdd6.json')
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  return { client_email: creds.client_email, private_key: creds.private_key }
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token
  }

  const creds = loadCredentials()
  const now = Math.floor(Date.now() / 1000)

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url')

  const signer = createSign('RSA-SHA256')
  signer.update(header + '.' + payload)
  const sig = signer.sign(creds.private_key).toString('base64url')
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

  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

export async function gmcRequest(method: string, path: string, body?: unknown): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`${BASE_URL}${path}`, {
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
  const token = await getAccessToken()
  const res = await fetch(`${BASE_URL}/products/${encodeURIComponent(productId)}`, {
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
