import crypto from 'crypto'

// HMAC-signed, purpose-tagged tokens for the customer OAuth flow (state, browser binding, pending sign-up).

function key(): string {
  const k = process.env.JWT_SECRET
  if (!k) throw new Error('JWT_SECRET environment variable is not set')
  return k
}

const mac = (purpose: string, payload: string) =>
  crypto.createHmac('sha256', key()).update(`social-oauth:${purpose}:${payload}`).digest('base64url')

export function signSocialToken(purpose: string, data: Record<string, unknown>, ttlSec: number): string {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url')
  return `${payload}.${mac(purpose, payload)}`
}

export function verifySocialToken<T>(purpose: string, token: string | null | undefined): T | null {
  if (!token || token.length > 8192) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const a = Buffer.from(sig)
  const b = Buffer.from(mac(purpose, payload))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now() / 1000) return null
    return parsed as T
  } catch {
    return null
  }
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url')
export const sha256url = (v: string) => crypto.createHash('sha256').update(v).digest('base64url')
