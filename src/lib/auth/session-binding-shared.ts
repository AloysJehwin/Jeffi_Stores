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

// The scope a key + bind cookie are valid across. The *_sid session cookies are set with
// Domain=.jeffistores.in, so the browser sends one session to every subdomain; binding must cover
// exactly those hosts and no wider. When the host is under the shared cookie domain we collapse to
// that domain (apex + all subdomains share one bind); otherwise the host is returned unchanged, so
// hosts that do NOT share a cookie stay host-pinned exactly as before — custom tenant domains, the
// tenant-admin admin-{slug}. host (its own host-scoped admin_sid_t cookie), and localhost/non-prod
// (cookieDomain undefined). cookieDomain is passed in to keep this file dependency-free.
export function bindScope(host: string | null | undefined, cookieDomain?: string | null): string {
  const h = normHost(host)
  if (!cookieDomain) return h
  const d = cookieDomain.replace(/^\./, '')
  return isUnderCookieDomain(h, cookieDomain) ? d : h
}

// Whether a host is covered by the shared cookie domain — the apex itself AND every subdomain. The
// bind cookie must carry Domain for exactly these hosts. bindScope() can't stand in for this: at the
// apex the scope equals the host, so a "scope !== host" test wrongly treats the apex as host-pinned
// and mints a host-only bind, which is why the apex logged out on reload.
export function isUnderCookieDomain(host: string | null | undefined, cookieDomain?: string | null): boolean {
  if (!cookieDomain) return false
  const h = normHost(host)
  const d = cookieDomain.replace(/^\./, '')
  return h === d || h.endsWith('.' + d)
}

export interface BindingContext {
  host: string
  method: string
  path: string
  bindCookies: Partial<Record<PrincipalType, string | null>>
  proof: string | null
  fetchDest: string | null
}
