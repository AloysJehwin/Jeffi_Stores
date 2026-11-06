import { createHmac, timingSafeEqual } from 'node:crypto'

// Short-lived HMAC token for service→service calls (MICROSERVICES_PLAN §auth).
// token = base64url(payload) + '.' + base64url(hmac_sha256(secret, payload))
export interface ServiceClaims {
  service: string
  tenantId: string
  apiKeyId?: string
  tenantSlug?: string
  internal?: boolean // platform-originated send: charged at provider cost, no public margin
  adminId?: string // admin-session-originated call (proxied from the monolith)
  userId?: string // customer-session-originated call (proxied from the monolith)
  role?: string
  scopes?: string[]
  space?: 'store' | 'api' // which template copies the caller reads/edits (default by service)
  exp: number
}

const SECRET = () => {
  const s = process.env.SERVICE_AUTH_SECRET
  if (!s) throw new Error('SERVICE_AUTH_SECRET is not set')
  return s
}
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')

export function signServiceToken(claims: Omit<ServiceClaims, 'exp'>, ttlSeconds = 60): string {
  const payload = JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  const sig = createHmac('sha256', SECRET()).update(payload).digest()
  return `${b64(payload)}.${b64(sig)}`
}

export function verifyServiceToken(token: string | undefined): ServiceClaims | null {
  if (!token) return null
  const [p, s] = token.split('.')
  if (!p || !s) return null
  const payload = Buffer.from(p, 'base64url').toString()
  const expected = createHmac('sha256', SECRET()).update(payload).digest()
  const given = Buffer.from(s, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  const claims = JSON.parse(payload) as ServiceClaims
  if (claims.exp < Math.floor(Date.now() / 1000)) return null
  return claims
}

export function bearer(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const h = req.headers.authorization
  const v = Array.isArray(h) ? h[0] : h
  return v && /^bearer /i.test(v) ? v.slice(7).trim() : undefined
}

// ── Admin gateway header ──
// public-api-service → a store's admin-service (or the controller): the principal behind a jfc_/jsa_
// token it already authenticated. Signed with ADMIN_GATEWAY_SECRET, which only public-api-service and the
// store apps hold (never messaging or documents pods, which hold SERVICE_AUTH_SECRET). Unset in
// production: nothing signs or verifies. Outside production it falls back to SERVICE_AUTH_SECRET.
export const GATEWAY_HEADER = 'x-jeffi-gateway'

export interface GatewayClaims {
  aud: 'admin-gateway'
  tenantId: string // the store; the flagship is the nil uuid
  kind: 'cli' | 'extension' | 'service_account'
  adminId?: string
  serviceAccountId?: string
  scopes: string[] // the token's own scopes (["*"] = the holder's current grant); the store narrows them
  tokenId: string
  host: string // the store's admin host the call is addressed to
  platform?: boolean // /v1/platform: the controller's ecom API
  exp: number
}

let warnedNoGatewaySecret = false

function gatewayKey(): Buffer | null {
  let s = process.env.ADMIN_GATEWAY_SECRET
  if (!s && process.env.NODE_ENV !== 'production' && process.env.SERVICE_AUTH_SECRET) s = `dev-only:${process.env.SERVICE_AUTH_SECRET}`
  if (!s) {
    if (!warnedNoGatewaySecret) console.warn('[admin-gateway] ADMIN_GATEWAY_SECRET is not set: the admin gateway is off')
    warnedNoGatewaySecret = true
    return null
  }
  return createHmac('sha256', s).update('jeffi-admin-gateway-v1').digest()
}

/** Whether this process can sign and verify the admin gateway header. */
export const gatewayConfigured = () => gatewayKey() !== null

export function signGatewayToken(claims: Omit<GatewayClaims, 'exp' | 'aud'>, ttlSeconds = 60): string {
  const key = gatewayKey()
  if (!key) throw new Error('ADMIN_GATEWAY_SECRET is not set')
  const payload = JSON.stringify({ ...claims, aud: 'admin-gateway', exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  const sig = createHmac('sha256', key).update(payload).digest()
  return `${b64(payload)}.${b64(sig)}`
}

export function verifyGatewayToken(token: string | null | undefined): GatewayClaims | null {
  if (!token || token.length > 8192) return null
  const key = gatewayKey()
  if (!key) return null
  const [p, s, extra] = token.split('.')
  if (!p || !s || extra !== undefined) return null
  let payload: string
  let expected: Buffer
  try {
    payload = Buffer.from(p, 'base64url').toString()
    expected = createHmac('sha256', key).update(payload).digest()
  } catch {
    return null
  }
  const given = Buffer.from(s, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let c: GatewayClaims
  try {
    c = JSON.parse(payload) as GatewayClaims
  } catch {
    return null
  }
  if (c.aud !== 'admin-gateway' || typeof c.exp !== 'number' || c.exp < Math.floor(Date.now() / 1000)) return null
  if (typeof c.tenantId !== 'string' || typeof c.tokenId !== 'string' || !Array.isArray(c.scopes)) return null
  if (c.kind !== 'cli' && c.kind !== 'extension' && c.kind !== 'service_account') return null
  if (c.kind === 'service_account' ? typeof c.serviceAccountId !== 'string' : typeof c.adminId !== 'string') return null
  return c
}
