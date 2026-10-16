import { platformOAuthBaseUrl, currentAdminBaseUrl } from '@/lib/catalog/brand'
import { getTenant } from '@/lib/tenant-registry'
import type { AdminOAuthState } from '@/lib/shared/oauth-state'

// Store-admin OAuth connect flows. Every provider redirects to ONE fixed platform host (one URI
// registered per provider covers every tenant); the signed state carries the tenant, and the
// callback sends the user back to that tenant's own admin.

// Flagship credentials are keyed to this sentinel tenant (see lib/import/jobs.ts); its admin is the platform one.
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

export type OAuthProvider = 'google_merchant' | 'amazon_seller' | 'meta' | 'google_ads'

export const OAUTH_CALLBACK_PATHS: Record<OAuthProvider, string> = {
  google_merchant: '/api/admin/integrations/google/callback',
  amazon_seller: '/api/admin/integrations/amazon/callback',
  meta: '/api/admin/social/callback',
  // Shares the Google callback; the route dispatches on state.provider (one URI for both Google flows).
  google_ads: '/api/admin/integrations/google/callback',
}

const REQUIRED_ENV: Record<OAuthProvider, string[]> = {
  google_merchant: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'CRON_SECRET'],
  amazon_seller: ['AMAZON_SP_APP_ID', 'AMAZON_LWA_APP_CLIENT_ID', 'AMAZON_LWA_APP_CLIENT_SECRET', 'CRON_SECRET'],
  meta: ['META_APP_ID', 'META_APP_SECRET', 'CRON_SECRET'],
  google_ads: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'CRON_SECRET'],
}

export function oauthRedirectUri(provider: OAuthProvider): string {
  return `${platformOAuthBaseUrl()}${OAUTH_CALLBACK_PATHS[provider]}`
}

export interface OAuthProviderInfo {
  enabled: boolean
  redirectUri: string
  missing: string[]
}

/** Whether the platform has the app credentials for a provider's OAuth flow, and the redirect URI
 * that must be registered in that provider's developer console. */
export function oauthProviderInfo(provider: OAuthProvider): OAuthProviderInfo {
  const missing = REQUIRED_ENV[provider].filter(k => !process.env[k])
  return { enabled: missing.length === 0, redirectUri: oauthRedirectUri(provider), missing }
}

/** admin-{slug} on the same root and scheme as the platform callback host: https://admin-acme.jeffistores.in
 * in production, http://admin-acme.localhost:3000 when ADMIN_BASE_URL is http://localhost:3000. */
export function tenantAdminUrl(slug: string): string {
  const u = new URL(platformOAuthBaseUrl())
  return `${u.protocol}//admin-${slug}.${u.host.replace(/^admin\./, '')}`
}

/** Admin base URL of the tenant the verified state belongs to. Callbacks land on the platform host
 * with no tenant in context, so this is derived from the state's tenantId, never the request. */
export async function tenantAdminBase(state: AdminOAuthState | null): Promise<string> {
  if (state?.tenantId && state.tenantId !== PLATFORM_TENANT_ID) {
    const tenant = await getTenant(state.tenantId).catch(() => null)
    if (tenant?.slug) return tenantAdminUrl(tenant.slug)
  }
  return currentAdminBaseUrl()
}

export function errorParam(e: unknown, fallback = 'exchange_failed'): string {
  const msg = (e as any)?.message || (typeof e === 'string' ? e : '') || fallback
  return encodeURIComponent(String(msg).slice(0, 120))
}
