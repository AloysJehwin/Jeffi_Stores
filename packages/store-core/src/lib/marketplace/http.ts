import { fetchWithRetry, type RetryOptions } from '@/lib/channels/ratelimit'

// Marketplace API calls: 429/5xx retried with backoff (shared channel fetch), a cached access token
// refreshed once on a 401, a per-key pace for the channel's rate limit, and no redirects.

export class MarketplaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message)
    this.name = 'MarketplaceApiError'
  }
}

const tokens = new Map<string, { token: string; expiresAt: number }>()

/** A cached token for `key`; `fetchToken` runs on a miss, near expiry, or when forced. */
export async function cachedToken(
  key: string,
  fetchToken: () => Promise<{ token: string; expiresInSecs?: number }>,
  force = false,
  now = Date.now()
): Promise<string> {
  const hit = tokens.get(key)
  if (!force && hit && hit.expiresAt > now + 60_000) return hit.token
  const { token, expiresInSecs } = await fetchToken()
  tokens.set(key, { token, expiresAt: now + (expiresInSecs ?? 3600) * 1000 })
  return token
}

export function clearTokenCache(key?: string): void {
  if (key) tokens.delete(key)
  else tokens.clear()
}

const lastCall = new Map<string, number>()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Waits so calls under one key stay within `perSecond`. */
export async function pace(key: string, perSecond: number): Promise<void> {
  if (!(perSecond > 0)) return
  const gap = 1000 / perSecond
  const at = Math.max(Date.now(), (lastCall.get(key) ?? 0) + gap)
  lastCall.set(key, at)
  const wait = at - Date.now()
  if (wait > 0) await sleep(wait)
}

export interface MarketplaceRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  /** Objects are sent as JSON; strings and buffers as they are. */
  body?: unknown
  /** Bearer-style auth: the token getter (force = refresh) and the header it goes in. */
  auth?: { getToken: (force: boolean) => Promise<string>; header?: string; scheme?: string }
  paceKey?: string
  perSecond?: number
  retry?: RetryOptions
  /** Whole call, retries included. */
  timeoutMs?: number
}

function encodeBody(body: unknown, headers: Record<string, string>): BodyInit | undefined {
  if (body == null) return undefined
  if (typeof body === 'string' || body instanceof Uint8Array) return body as BodyInit
  if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
  return JSON.stringify(body)
}

/** The raw response (for PDFs and the like); throws MarketplaceApiError on a non-2xx. */
export async function marketplaceRequest(req: MarketplaceRequest): Promise<Response> {
  const send = async (force: boolean) => {
    const headers: Record<string, string> = { Accept: 'application/json', ...req.headers }
    if (req.auth) {
      const token = await req.auth.getToken(force)
      const scheme = req.auth.scheme ?? 'Bearer'
      headers[req.auth.header ?? 'Authorization'] = scheme ? `${scheme} ${token}` : token
    }
    if (req.paceKey) await pace(req.paceKey, req.perSecond ?? 0)
    return fetchWithRetry(
      req.url,
      { method: req.method ?? 'GET', headers, body: encodeBody(req.body, headers), redirect: 'error', signal: AbortSignal.timeout(req.timeoutMs ?? 60_000) },
      req.retry
    )
  }
  let res = await send(false)
  if (res.status === 401 && req.auth) res = await send(true)
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 2000)
    throw new MarketplaceApiError(`Marketplace API returned HTTP ${res.status}`, res.status, text)
  }
  return res
}

/** Parsed JSON body (null for an empty one). */
export async function marketplaceJson<T = any>(req: MarketplaceRequest): Promise<T> {
  const res = await marketplaceRequest(req)
  const text = await res.text()
  if (!text) return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new MarketplaceApiError('Marketplace API returned a response that is not JSON', res.status, text.slice(0, 2000))
  }
}
