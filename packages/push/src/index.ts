import { createSign } from 'node:crypto'

// FCM HTTP v1 client (no SDK). Credentials: FCM_SERVICE_ACCOUNT_JSON, the Firebase service account
// JSON as-is or base64-encoded. One HTTP call per token; v1 has no multicast.
export type PushCategory = 'orders' | 'account' | 'offers' | 'price_alerts'
export const PUSH_CATEGORIES: readonly PushCategory[] = ['orders', 'account', 'offers', 'price_alerts']

export interface PushMessage {
  title: string
  body: string
  image?: string
  /** Storefront path the app opens on tap. */
  link?: string
  /** Also the Android notification channel id. */
  category: PushCategory
  /** A newer push with the same key replaces the older one on the device. */
  collapseKey?: string
  data?: Record<string, string | number | boolean | null | undefined>
}

export interface PushResult {
  token: string
  ok: boolean
  messageId?: string
  error?: string
  /** The token is dead (uninstalled, rotated, other project): stop sending to it. */
  invalidToken: boolean
}

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const TOKEN_URI = 'https://oauth2.googleapis.com/token'
const CONCURRENCY = 16
const HIGH_PRIORITY = new Set<PushCategory>(['orders', 'account'])

let parsed: { raw: string; sa: ServiceAccount | null } | null = null
function serviceAccount(): ServiceAccount | null {
  const raw = (process.env.FCM_SERVICE_ACCOUNT_JSON ?? '').trim()
  if (!raw) return null
  if (parsed?.raw === raw) return parsed.sa
  let sa: ServiceAccount | null = null
  try {
    const j = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
    if (j?.project_id && j?.client_email && j?.private_key) sa = { ...j, private_key: String(j.private_key).replace(/\\n/g, '\n') }
  } catch {
    sa = null
  }
  parsed = { raw, sa }
  return sa
}

export const pushConfigured = () => serviceAccount() !== null

let cached: { value: string; expiresAt: number; email: string } | null = null
let pending: Promise<string> | null = null

async function accessToken(sa: ServiceAccount, force = false): Promise<string> {
  if (!force && cached?.email === sa.client_email && Date.now() < cached.expiresAt - 5 * 60_000) return cached.value
  if (pending) return pending
  pending = (async () => {
    const now = Math.floor(Date.now() / 1000)
    const aud = sa.token_uri || TOKEN_URI
    const b64 = (s: string) => Buffer.from(s).toString('base64url')
    const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }))}`
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')
    const res = await fetch(aud, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
      signal: AbortSignal.timeout(10_000),
    })
    const b = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    if (!res.ok || !b.access_token) throw new Error(`FCM auth failed: ${b.error_description ?? b.error ?? `HTTP ${res.status}`}`)
    cached = { value: b.access_token, expiresAt: Date.now() + Number(b.expires_in ?? 3600) * 1000, email: sa.client_email }
    return cached.value
  })().finally(() => {
    pending = null
  })
  return pending
}

function message(token: string, m: PushMessage) {
  const data: Record<string, string> = {}
  for (const [k, v] of Object.entries(m.data ?? {})) if (v != null) data[k] = String(v)
  if (m.link) data.link = m.link
  data.category = m.category
  return {
    message: {
      token,
      notification: { title: m.title, body: m.body, ...(m.image ? { image: m.image } : {}) },
      data,
      android: {
        priority: HIGH_PRIORITY.has(m.category) ? 'HIGH' : 'NORMAL',
        ...(m.collapseKey ? { collapse_key: m.collapseKey } : {}),
        notification: { channel_id: m.category, ...(m.collapseKey ? { tag: m.collapseKey } : {}) },
      },
    },
  }
}

// FCM v1 errors: details[] carries an FcmError { errorCode } and, for bad fields, a BadRequest.
function classify(status: number, body: any): { error: string; invalidToken: boolean } {
  const e = body?.error ?? {}
  const details: any[] = Array.isArray(e.details) ? e.details : []
  const code: string = details.find(d => d?.errorCode)?.errorCode ?? e.status ?? `HTTP_${status}`
  const onToken =
    details.some(d => Array.isArray(d?.fieldViolations) && d.fieldViolations.some((f: any) => /token/i.test(String(f?.field ?? '')))) ||
    /registration token/i.test(String(e.message ?? ''))
  const invalidToken = code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH' || (code === 'INVALID_ARGUMENT' && onToken)
  return { error: `${code}${e.message ? `: ${e.message}` : ''}`.slice(0, 300), invalidToken }
}

async function sendOne(sa: ServiceAccount, token: string, m: PushMessage): Promise<PushResult> {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`
  const body = JSON.stringify(message(token, m))
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken(sa, attempt > 0)}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      const json = (await res.json().catch(() => ({}))) as any
      if (res.ok) return { token, ok: true, messageId: json?.name, invalidToken: false }
      // An access token revoked early: mint a fresh one once.
      if (res.status === 401 && attempt === 0) continue
      return { token, ok: false, ...classify(res.status, json) }
    }
  } catch (e: any) {
    return { token, ok: false, error: String(e?.message ?? e).slice(0, 300), invalidToken: false }
  }
}

/** One message per token, at most CONCURRENCY in flight. Never throws; failures come back per token. */
export async function sendPush(tokens: string[], msg: PushMessage): Promise<PushResult[]> {
  const list = [...new Set(tokens.filter(t => typeof t === 'string' && t.length > 0))]
  const sa = serviceAccount()
  if (!sa) return list.map(token => ({ token, ok: false, error: 'push is not configured', invalidToken: false }))
  try {
    await accessToken(sa)
  } catch (e: any) {
    return list.map(token => ({ token, ok: false, error: String(e?.message ?? e).slice(0, 300), invalidToken: false }))
  }
  const out = new Array<PushResult>(list.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
      while (next < list.length) {
        const i = next++
        out[i] = await sendOne(sa, list[i], msg)
      }
    })
  )
  return out
}
