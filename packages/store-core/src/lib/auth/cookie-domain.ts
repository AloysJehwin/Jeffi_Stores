import { isUnderCookieDomain } from '@/lib/auth/session-binding-shared'

// Returns the cookie domain so auth cookies are shared across the apex
// (jeffistores.in) and any subdomain (www., business., admin., etc.).
// In non-production we return undefined so the cookie stays host-scoped to
// localhost / preview hosts. When a request host is passed and it is not under
// that domain (a custom store domain), returns undefined: the browser rejects a
// Domain that doesn't match the host, so the cookie must be host-only there.
export function getCookieDomain(host?: string | null): string | undefined {
  if (process.env.NODE_ENV !== 'production') return undefined
  const domain = process.env.COOKIE_DOMAIN || '.jeffistores.in'
  if (host && !isUnderCookieDomain(host, domain)) return undefined
  return domain
}

// Spread into a cookie options object: { ...cookieDomainOption(host) }
export function cookieDomainOption(host?: string | null): { domain?: string } {
  const domain = getCookieDomain(host)
  return domain ? { domain } : {}
}
