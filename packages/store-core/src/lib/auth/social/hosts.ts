import { businessBaseUrlAsync, storeBaseUrlAsync } from '@/lib/catalog/brand'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { routedCustomDomains } from '@/lib/tenant-registry'
import { SOCIAL_PROVIDERS, type SocialProvider } from './types'

export interface SignInHost {
  label: string
  /** Scheme + host, no path. */
  origin: string
}

/** The store's customer-facing hosts: sign-in can start on any of them, so each needs its redirect URI registered. */
export async function signInHosts(): Promise<SignInHost[]> {
  const out: SignInHost[] = []
  const add = (label: string, url: string) => {
    try {
      const origin = new URL(url).origin
      if (!out.some(h => h.origin === origin)) out.push({ label, origin })
    } catch {}
  }
  add('Storefront', await storeBaseUrlAsync())
  add('Business portal', await businessBaseUrlAsync())
  const tenant = await resolveTenant().catch(() => null)
  if (tenant) {
    for (const d of await routedCustomDomains(tenant.tenantId).catch(() => [])) add('Custom domain', `https://${d}`)
  }
  return out
}

export const signInRedirectUris = (hosts: SignInHost[]): Record<SocialProvider, Array<{ label: string; uri: string }>> =>
  Object.fromEntries(
    SOCIAL_PROVIDERS.map(p => [p, hosts.map(h => ({ label: h.label, uri: `${h.origin}/api/auth/oauth/${p}/callback` }))])
  ) as Record<SocialProvider, Array<{ label: string; uri: string }>>
