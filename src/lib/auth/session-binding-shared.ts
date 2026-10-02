import type { PrincipalType } from '@/lib/auth/auth-sessions'

// Dependency-free half of session binding (see session-binding.ts): names and request context
// only, so the middleware and the client can share them without pulling in the database driver.

export const BIND_ENDPOINT = '/api/auth/rt'
export const PROOF_HEADER = 'x-rt'
export const BIND_TTL_S = 300

// Deliberately plain names: nothing here reads as "this one matters".
export const BIND_COOKIE: Record<PrincipalType, string> = {
  customer: '_vu',
  business: '_vb',
  admin: '_va',
  owner: '_vo',
}

// EventSource and sendBeacon cannot set a header but still need the short-lived cookie. Matched by
// exact path, never by a request header. Read probes (/me, check-session) are not listed here: they
// are exempt by method (reads never require a proof) in evaluateKeyBinding.
export const PROOF_EXEMPT_PATHS: ReadonlySet<string> = new Set(['/api/admin/events', '/api/track'])

export function normHost(host: string | null | undefined): string {
  return String(host ?? '')
    .toLowerCase()
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
}

export interface BindingContext {
  host: string
  method: string
  path: string
  bindCookies: Partial<Record<PrincipalType, string | null>>
  proof: string | null
  fetchDest: string | null
}
