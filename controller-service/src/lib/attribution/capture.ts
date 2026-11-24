// Ad attribution on the ecom landing: the Google click ids and UTM tags in the URL go into a first-party cookie
// (90 days) that signup reads. Pure helpers; the route sets the cookie, persist.ts saves it with the owner.

export const ATTRIBUTION_COOKIE = 'jeffi_attr'
export const ATTRIBUTION_MAX_AGE_S = 90 * 24 * 60 * 60

export const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid'] as const
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

export type ClickIdKey = (typeof CLICK_ID_KEYS)[number]
export type UtmKey = (typeof UTM_KEYS)[number]

export interface Attribution {
  gclid?: string
  gbraid?: string
  wbraid?: string
  utm: Partial<Record<UtmKey, string>>
  landingPath?: string
  /** ISO time of the capture. */
  seenAt: string
}

const MAX_VALUE = 255
const ID_RE = /^[A-Za-z0-9_\-.]+$/

const clean = (v: unknown, max = MAX_VALUE): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && s.length <= max ? s : null
}

/** Known click ids and UTM tags from a query (a record or URLSearchParams); null when there is none. */
export function parseAttribution(
  input: Record<string, unknown> | URLSearchParams | null | undefined,
  landingPath?: unknown,
  now: Date = new Date()
): Attribution | null {
  if (!input) return null
  const get = (k: string): unknown => (input instanceof URLSearchParams ? input.get(k) : input[k])
  const out: Attribution = { utm: {}, seenAt: now.toISOString() }
  let any = false
  for (const k of CLICK_ID_KEYS) {
    const v = clean(get(k))
    if (v && ID_RE.test(v)) {
      out[k] = v
      any = true
    }
  }
  for (const k of UTM_KEYS) {
    const v = clean(get(k), 200)
    if (v) {
      out.utm[k] = v
      any = true
    }
  }
  if (!any) return null
  const path = clean(landingPath, 500)
  if (path && path.startsWith('/')) out.landingPath = path
  return out
}

export const hasClickId = (a: Pick<Attribution, ClickIdKey> | null | undefined): boolean => !!a && !!(a.gclid || a.gbraid || a.wbraid)

/** A new landing replaces the cookie, except one without a click id never replaces one that has it. */
export function mergeAttribution(existing: Attribution | null, next: Attribution): Attribution {
  if (existing && hasClickId(existing) && !hasClickId(next)) return existing
  return next
}

/** The cookie value; Next percent-encodes it when setting and decodes it when reading. */
export function encodeAttribution(a: Attribution): string {
  return JSON.stringify(a)
}

export function decodeAttribution(raw: string | null | undefined): Attribution | null {
  if (!raw) return null
  try {
    // Next hands back the decoded value; a still percent-encoded one (a proxy re-encoding it) is decoded here.
    const j = JSON.parse(raw.startsWith('%7B') ? decodeURIComponent(raw) : raw)
    return parseAttribution({ ...j, ...(j?.utm ?? {}) }, j?.landingPath, new Date(j?.seenAt || Date.now()))
  } catch {
    return null
  }
}

export function attributionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: ATTRIBUTION_MAX_AGE_S,
    path: '/',
  }
}
