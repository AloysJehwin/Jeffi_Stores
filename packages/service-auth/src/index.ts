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
  return v?.startsWith('Bearer ') ? v.slice(7) : undefined
}
