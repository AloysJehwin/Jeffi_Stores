// Returns the cookie domain so auth cookies are shared across the apex
// (jeffistores.in) and any subdomain (www., business., admin., etc.).
// In non-production we return undefined so the cookie stays host-scoped to
// localhost / preview hosts.
export function getCookieDomain(): string | undefined {
  if (process.env.NODE_ENV !== 'production') return undefined
  return process.env.COOKIE_DOMAIN || '.jeffistores.in'
}

// Spread into a cookie options object: { ...cookieDomainOption() }
export function cookieDomainOption(): { domain?: string } {
  const domain = getCookieDomain()
  return domain ? { domain } : {}
}
