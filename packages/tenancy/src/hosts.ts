export const RESERVED_LABELS = new Set([
  'admin', 'business', 'forms', 'vault', 'www', 'ecom', 'invoice', 'quotation', 'purchaseorder',
  'api', 'app', 'mail', 'static', 'assets', 'cdn', 'certificate', 'public',
])

export const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || process.env.PLATFORM_DOMAIN || 'jeffistores.in'

export type HostApp = 'admin' | 'invoice' | 'quotation' | 'purchaseorder' | 'forms' | 'business' | 'vault'
const APP_PREFIXES: HostApp[] = ['admin', 'invoice', 'quotation', 'purchaseorder', 'forms', 'business', 'vault']

const isLocal = (h: string) =>
  h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '127.0.0.1' || h === '::1' || h === '[::1]'

const rootFor = (host: string) => (host === 'localhost' || host.endsWith('.localhost') ? 'localhost' : ROOT_DOMAIN)

export function slugFromHost(hostname: string): { slug: string | null; isCustomDomain: boolean } {
  const host = hostname.toLowerCase().split(':')[0].trim()
  const root = rootFor(host)
  if (!host.endsWith('.' + root) && host !== root) return { slug: null, isCustomDomain: !!host && !isLocal(host) }
  if (host === root) return { slug: null, isCustomDomain: false }
  const label = host.slice(0, host.length - root.length - 1)
  const business = label.match(/^(.+)\.business$/)
  const app = label.match(/^(admin|invoice|quotation|purchaseorder|forms|vault|www)-(.+)$/)
  const bare = business ? business[1] : app ? app[2] : label
  if (RESERVED_LABELS.has(bare) || bare.includes('.')) return { slug: null, isCustomDomain: false }
  return { slug: bare, isCustomDomain: false }
}

export function appFromHost(hostname: string): HostApp | null {
  const host = hostname.toLowerCase().split(':')[0].trim()
  const root = rootFor(host)
  const underRoot = host.endsWith('.' + root)
  const label = underRoot ? host.slice(0, host.length - root.length - 1) : host
  const parts = label.split('.')
  if (underRoot && parts.length === 2 && parts[1] === 'business') return 'business'
  for (const p of APP_PREFIXES) {
    if (parts[0] === p) return p
    if (underRoot && parts[0].startsWith(p + '-')) return p
  }
  return null
}

export function documentHostForSlug(app: 'invoice' | 'quotation' | 'purchaseorder', slug: string): string {
  return `${app}-${slug}.${ROOT_DOMAIN}`
}
