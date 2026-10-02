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

// Script-made API calls that cannot carry a header: EventSource and sendBeacon have no way to set
// one. They still need the short-lived cookie. Matched by exact path, never by a request header,
// because a header is the caller's to fake and would switch the proof off for any endpoint.
//
// The read-only session checks (/me) are exempt too. AuthContext fires them first thing on every
// page load, racing the guard's bind (capped at BIND_WAIT_MS); when the bind cookie is not there yet
// the call went out proof-required, enforcement refused it, and the route answered 200 {user:null},
// which the client reads as logged out — the storefront "logged out on reload" bug. A "who am I"
// read gains nothing from binding; refusing it only signs real users out. Mutations stay protected.
export const PROOF_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/api/admin/events',
  '/api/track',
  '/api/auth/me',
  '/api/business/me',
  '/api/ecom/auth/me',
])

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
