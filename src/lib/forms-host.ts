const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || process.env.NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

const RESERVED_LABELS = new Set(['admin', 'invoice', 'quotation', 'purchaseorder', 'forms', 'business', 'www', 'app', 'ecom'])

function isLocalHost(host: string): boolean {
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '127.0.0.1'
    || host === '::1'
    || host === '[::1]'
}

/** Tenant slug encoded in a host, or null for the platform / a custom domain. Pure string logic, safe in the client bundle. */
export function slugFromHostname(hostname: string): string | null {
  const host = hostname.toLowerCase().split(':')[0].trim()
  if (isLocalHost(host)) return null
  if (!host.endsWith('.' + ROOT_DOMAIN) && host !== ROOT_DOMAIN) return null
  if (host === ROOT_DOMAIN) return null
  const label = host.slice(0, host.length - ROOT_DOMAIN.length - 1)
  const businessScoped = label.match(/^(.+)\.business$/)
  const appPrefixed = label.match(/^(admin|invoice|quotation|purchaseorder|forms|www)-(.+)$/)
  const bare = businessScoped ? businessScoped[1] : appPrefixed ? appPrefixed[2] : label
  if (RESERVED_LABELS.has(bare)) return null
  if (bare.includes('.')) return null
  return bare
}

/** Public forms host for a tenant slug; null (platform / custom domain) → the platform forms host. */
export function formsHostForSlug(slug: string | null): string {
  return slug ? `forms-${slug}.${ROOT_DOMAIN}` : `forms.${ROOT_DOMAIN}`
}

/** Forms host that preserves the tenant of the given request host. */
export function formsHostForHost(hostname: string): string {
  return formsHostForSlug(slugFromHostname(hostname))
}

/** Storefront host for a tenant slug; null (platform / custom domain) → the platform storefront host. */
export function storeHostForSlug(slug: string | null): string {
  return slug ? `${slug}.${ROOT_DOMAIN}` : ROOT_DOMAIN
}

/** Storefront host that preserves the tenant of the given request host. */
export function storeHostForHost(hostname: string): string {
  return storeHostForSlug(slugFromHostname(hostname))
}
