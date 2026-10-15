import { resolveTenant } from '@/lib/tenancy/tenant-context'

const trimSlash = (url: string) => url.replace(/\/+$/, '')

async function verifiedCustomDomain(tenantId: string): Promise<string | null> {
  try {
    const { listCustomDomains } = await import('@/lib/tenant-registry')
    const domains = await listCustomDomains(tenantId)
    return domains.find(d => d.status === 'verified')?.domain ?? null
  } catch {
    return null
  }
}

/**
 * Public storefront origin for product links sent to outside catalogues (Merchant Center, the XML
 * feed, Sheets). Flagship: the configured public site URL, which Merchant Center verifies links
 * against. Tenant: its verified custom domain, else `{slug}.<platform domain>`.
 */
export async function storePublicBaseUrl(): Promise<string> {
  const platformDomain = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  const tenant = await resolveTenant()
  if (!tenant?.slug) {
    return trimSlash(process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_URL || `https://${platformDomain}`)
  }
  const domain = await verifiedCustomDomain(tenant.tenantId)
  return domain ? `https://${domain}` : `https://${tenant.slug}.${platformDomain}`
}
