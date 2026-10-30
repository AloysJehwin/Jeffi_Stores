import type { NextResponse } from 'next/server'
import { returnToAdmin, type AdminOAuthState } from '@/lib/shared/oauth-state'
import { oauthRedirectUri, tenantAdminBase, errorParam } from '@/lib/integrations/oauth'
import { readAdsConfig, saveAdsConfig, type GoogleAdsConfig } from './credentials'
import { GoogleAdsClient } from './client'
import { verifyAccount } from './accounts'

// Google Ads leg of the shared Google OAuth callback (/api/admin/integrations/google/callback,
// dispatched on state.provider), so Ads needs no redirect URI of its own. Trust comes from the
// signed state; the refresh token is stored as a pending connection and the owner then picks the
// account on the Google Ads page. A reconnect (state.keepAccount) keeps the account it had when
// the new sign-in can still read it, so adding the Data Manager scope needs no re-pick.
export async function completeGoogleAdsOAuth(params: URLSearchParams, state: AdminOAuthState): Promise<NextResponse> {
  const backTo = `${await tenantAdminBase(state)}/admin/google-ads`
  const fail = (reason: string) => returnToAdmin(`${backTo}?connected=0&provider=google_ads&error=${reason}`)

  const err = params.get('error')
  if (err) return fail(errorParam(err))
  const code = params.get('code')
  if (!code) return fail('missing_params')

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail('not_configured')

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: oauthRedirectUri('google_ads'),
        grant_type: 'authorization_code',
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.refresh_token) {
      return fail(errorParam(data?.error_description || data?.error || 'no_refresh_token'))
    }
    if (typeof data.scope === 'string' && !data.scope.includes('auth/adwords')) return fail('scope_not_granted')
    // Granular consent can drop the Data Manager scope; Google Ads still works, uploads ask again.
    const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : undefined
    const base: GoogleAdsConfig = { oauth_refresh_token: data.refresh_token, connected_via: 'oauth', ...(scopes ? { scopes } : {}) }

    if (state.keepAccount && (await keepAccount(state.tenantId, base))) {
      return returnToAdmin(`${backTo}?connected=google_ads&tab=conversions`)
    }
    await saveAdsConfig(state.tenantId, base)
    return returnToAdmin(`${backTo}?connected=google_ads&pick=1`)
  } catch (e) {
    return fail(errorParam(e))
  }
}

async function keepAccount(tenantKey: string, base: GoogleAdsConfig): Promise<boolean> {
  const prev = await readAdsConfig(tenantKey).catch(() => null)
  if (!prev?.customer_id || (prev.connected_via !== 'oauth' && prev.connected_via !== 'manual')) return false
  try {
    const info = await verifyAccount(
      new GoogleAdsClient({
        refreshToken: base.oauth_refresh_token,
        customerId: prev.customer_id,
        loginCustomerId: prev.login_customer_id,
        retryDelays: [],
      })
    )
    await saveAdsConfig(
      tenantKey,
      { ...base, customer_id: prev.customer_id, login_customer_id: prev.login_customer_id },
      { account_name: info.descriptive_name }
    )
    return true
  } catch {
    return false
  }
}
