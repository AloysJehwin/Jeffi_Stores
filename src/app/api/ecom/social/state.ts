import crypto from 'crypto'

// Signed OAuth state for the Meta connect flow. HMAC-signs a compact JSON payload with
// CRON_SECRET (a server-only secret already present) so the callback can trust the tenantId
// it receives — the browser can't forge or tamper with it, and the nonce makes each flow
// single-use in practice.

export interface OAuthState {
  tenantId: string
  provider: string
  ownerId: string
  nonce: string
}

function key(): string {
  const k = process.env.CRON_SECRET
  if (!k) throw new Error('CRON_SECRET not set — required to sign OAuth state')
  return k
}

export function signState(s: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url')
  const sig = crypto.createHmac('sha256', key()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** Verify + parse a signed state. Returns null if the signature doesn't match. */
export function verifyState(state: string): OAuthState | null {
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return null
  const expected = crypto.createHmac('sha256', key()).update(payload).digest('base64url')
  // constant-time compare
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState
  } catch {
    return null
  }
}
