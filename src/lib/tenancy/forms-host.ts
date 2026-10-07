const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || process.env.NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

const RESERVED_LABELS = new Set([
  'admin',
  'invoice',
  'quotation',
  'purchaseorder',
  'forms',
  'vault',
  'business',
  'www',
  'app',
  'ecom',
])

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  )
}

/** Tenant slug encoded in a host, or null for the platform / a custom domain. Pure string logic, safe in the client bundle. */
export function slugFromHostname(hostname: string): string | null {
  const host = hostname.toLowerCase().split(':')[0].trim()
  if (isLocalHost(host)) return null
  if (!host.endsWith('.' + ROOT_DOMAIN) && host !== ROOT_DOMAIN) return null
  if (host === ROOT_DOMAIN) return null
  const label = host.slice(0, host.length - ROOT_DOMAIN.length - 1)
  const businessScoped = label.match(/^(.+)\.business$/)
  const appPrefixed = label.match(/^(admin|invoice|quotation|purchaseorder|forms|vault|www)-(.+)$/)
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

/** Vault host for a tenant slug; null (platform) → the platform vault host. */
export function vaultHostForSlug(slug: string | null): string {
  return slug ? `vault-${slug}.${ROOT_DOMAIN}` : `vault.${ROOT_DOMAIN}`
}

/** Vault host that preserves the tenant of the given request host. */
export function vaultHostForHost(hostname: string): string {
  return vaultHostForSlug(slugFromHostname(hostname))
}

/** Storefront host for a tenant slug; null (platform / custom domain) → the platform storefront host. */
export function storeHostForSlug(slug: string | null): string {
  return slug ? `${slug}.${ROOT_DOMAIN}` : ROOT_DOMAIN
}

/** Storefront host that preserves the tenant of the given request host. */
export function storeHostForHost(hostname: string): string {
  return storeHostForSlug(slugFromHostname(hostname))
}

/** Token-addressed document apps, each on its own host: `{app}.` (platform) or `{app}-{slug}.` (tenant). */
export type DocumentApp = 'invoice' | 'quotation' | 'purchaseorder'

/**
 * Public host for a document app. Every plan that can create a document also gets its host
 * (provisioning tenantHostnames): invoices from Basic, quotations and POs from Growth.
 */
export function documentHostForSlug(app: DocumentApp, slug: string | null): string {
  return slug ? `${app}-${slug}.${ROOT_DOMAIN}` : `${app}.${ROOT_DOMAIN}`
}

/** Document host that preserves the tenant of the given request host. */
export function documentHostForHost(app: DocumentApp, hostname: string): string {
  return documentHostForSlug(app, slugFromHostname(hostname))
}

/**
 * Business-portal host for the tenant of the given host: `business.` (platform) or
 * `{slug}.business.` (tenant). Business customers only exist on plans that get this host.
 */
export function businessHostForHost(hostname: string): string {
  const slug = slugFromHostname(hostname)
  return slug ? `${slug}.business.${ROOT_DOMAIN}` : `business.${ROOT_DOMAIN}`
}
