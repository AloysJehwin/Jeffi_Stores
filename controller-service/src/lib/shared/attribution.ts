// First-party ad-click / UTM attribution: captured on landing, kept 90 days in a cookie (last
// non-direct click wins), sent with page events and stamped on orders. Isomorphic, no deps.

export const ATTRIBUTION_COOKIE = 'jeffi_attr'
export const ATTRIBUTION_MAX_AGE_DAYS = 90
const MAX_AGE_MS = ATTRIBUTION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000

export const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid'] as const
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
const PARAM_KEYS = [...CLICK_ID_KEYS, ...UTM_KEYS] as const

export type AttributionKey = (typeof PARAM_KEYS)[number]

export type Attribution = Partial<Record<AttributionKey, string>> & {
  landing_path: string
  /** Epoch ms of the click that set this attribution. */
  ts: number
}

const MAX_VALUE_LEN = 255

function clean(v: string | null | undefined, max = MAX_VALUE_LEN): string | undefined {
  if (v == null) return undefined
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return s ? s.slice(0, max) : undefined
}

/** Attribution carried by a landing URL, or null for a direct / organic visit (no click id or UTM). */
export function parseLandingParams(search: string, path: string, now: number = Date.now()): Attribution | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const out: Attribution = { landing_path: clean(path, 500) || '/', ts: now }
  let found = false
  for (const k of PARAM_KEYS) {
    const v = clean(params.get(k))
    if (v) {
      out[k] = v
      found = true
    }
  }
  return found ? out : null
}

export function isExpired(a: Attribution, now: number = Date.now()): boolean {
  return !Number.isFinite(a.ts) || now - a.ts > MAX_AGE_MS || a.ts - now > 60_000
}

/** Last non-direct click wins: a new click replaces the stored one; a direct visit keeps it until expiry. */
export function mergeAttribution(
  existing: Attribution | null,
  incoming: Attribution | null,
  now: number = Date.now()
): Attribution | null {
  if (incoming) return incoming
  if (existing && !isExpired(existing, now)) return existing
  return null
}

export function hasClickId(a: Partial<Attribution> | null | undefined): boolean {
  return !!a && CLICK_ID_KEYS.some(k => !!a[k])
}

export function serializeAttribution(a: Attribution): string {
  return encodeURIComponent(JSON.stringify(a))
}

export function parseAttribution(raw: string | null | undefined, now: number = Date.now()): Attribution | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(decodeURIComponent(raw))
    if (!obj || typeof obj !== 'object') return null
    const ts = Number(obj.ts)
    const out: Attribution = { landing_path: clean(String(obj.landing_path ?? ''), 500) || '/', ts }
    let found = false
    for (const k of PARAM_KEYS) {
      const v = typeof obj[k] === 'string' ? clean(obj[k]) : undefined
      if (v) {
        out[k] = v
        found = true
      }
    }
    if (!found || isExpired(out, now)) return null
    return out
  } catch {
    return null
  }
}

/** Reads the attribution cookie out of a raw Cookie header. */
export function attributionFromCookieHeader(
  header: string | null | undefined,
  now: number = Date.now()
): Attribution | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === ATTRIBUTION_COOKIE) return parseAttribution(part.slice(i + 1).trim(), now)
  }
  return null
}

/** Browser only: capture the current URL into the cookie and return the effective attribution. */
export function captureAttribution(now: number = Date.now()): Attribution | null {
  if (typeof document === 'undefined') return null
  try {
    const existing = attributionFromCookieHeader(document.cookie, now)
    const incoming = parseLandingParams(window.location.search, window.location.pathname, now)
    const next = mergeAttribution(existing, incoming, now)
    if (incoming && next) {
      const secure = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${ATTRIBUTION_COOKIE}=${serializeAttribution(next)}; Path=/; Max-Age=${ATTRIBUTION_MAX_AGE_DAYS * 86400}; SameSite=Lax${secure}`
    }
    return next
  } catch {
    return null
  }
}
