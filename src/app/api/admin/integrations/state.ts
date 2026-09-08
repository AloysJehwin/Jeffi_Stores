import crypto from 'crypto'

// Signed OAuth state for the store-admin connect flows. HMAC-signs a compact JSON payload with
// CRON_SECRET (a server-only secret) so the callback can trust the tenantId it receives — the
// browser can't forge or tamper with it, and the nonce makes each flow single-use in practice.
// Distinct from the ecom owner-console state: here the authz binding is the tenantId (re-checked
// against the callback's ALS tenant), not an owner id.

export interface AdminOAuthState {
  tenantId: string
  provider: string
  nonce: string
  spreadsheetId?: string
  // Tenant's own admin base URL, stamped at connect time (on the tenant host) so the callback —
  // which always lands on the platform OAuth host with no tenant in context — can return the user
  // to their own admin instead of the platform's.
  returnBase?: string
}

function key(): string {
  const k = process.env.CRON_SECRET
  if (!k) throw new Error('CRON_SECRET not set — required to sign OAuth state')
  return k
}

export function signAdminState(s: AdminOAuthState): string {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url')
  const sig = crypto.createHmac('sha256', key()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyAdminState(state: string): AdminOAuthState | null {
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return null
  const expected = crypto.createHmac('sha256', key()).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AdminOAuthState
  } catch {
    return null
  }
}
