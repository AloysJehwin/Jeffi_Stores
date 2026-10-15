import { platformOAuthBaseUrl, currentAdminBaseUrl } from '@/lib/catalog/brand'
import { getTenant } from '@/lib/tenant-registry'
import type { AdminOAuthState } from '@/lib/shared/oauth-state'

// Store-admin OAuth connect flows. Every provider redirects to ONE fixed platform host (one URI
// registered per provider covers every tenant); the signed state carries the tenant, and the
// callback sends the user back to that tenant's own admin.

const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || 'jeffistores.in'

export type OAuthProvider = 'google_merchant' | 'amazon_seller' | 'meta'

export const OAUTH_CALLBACK_PATHS: Record<OAuthProvider, string> = {
  google_merchant: '/api/admin/integrations/google/callback',
  amazon_seller: '/api/admin/integrations/amazon/callback',
  meta: '/api/admin/social/callback',
}

const REQUIRED_ENV: Record<OAuthProvider, string[]> = {
  google_merchant: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'CRON_SECRET'],
  amazon_seller: ['AMAZON_SP_APP_ID', 'AMAZON_LWA_APP_CLIENT_ID', 'AMAZON_LWA_APP_CLIENT_SECRET', 'CRON_SECRET'],
  meta: ['META_APP_ID', 'META_APP_SECRET', 'CRON_SECRET'],
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

/** Admin base URL of the tenant the verified state belongs to. Callbacks land on the platform host
 * with no tenant in context, so this is derived from the state's tenantId, never the request. */
export async function tenantAdminBase(state: AdminOAuthState | null): Promise<string> {
  if (state?.tenantId) {
    const tenant = await getTenant(state.tenantId).catch(() => null)
    if (tenant?.slug) return `https://admin-${tenant.slug}.${PLATFORM_DOMAIN}`
  }
  return currentAdminBaseUrl()
}

export function errorParam(e: unknown, fallback = 'exchange_failed'): string {
  const msg = (e as any)?.message || (typeof e === 'string' ? e : '') || fallback
  return encodeURIComponent(String(msg).slice(0, 120))
}
