import type { NextResponse } from 'next/server'
import { returnToAdmin, type AdminOAuthState } from '@/lib/shared/oauth-state'
import { oauthRedirectUri, tenantAdminBase, errorParam } from '@/lib/integrations/oauth'
import { saveAdsConfig } from './credentials'

// Google Ads leg of the shared Google OAuth callback (/api/admin/integrations/google/callback,
// dispatched on state.provider), so Ads needs no redirect URI of its own. Trust comes from the
// signed state; the refresh token is stored as a pending connection and the owner then picks the
// account on the Google Ads page.
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

    await saveAdsConfig(state.tenantId, { oauth_refresh_token: data.refresh_token, connected_via: 'oauth' })
    return returnToAdmin(`${backTo}?connected=google_ads&pick=1`)
  } catch (e) {
    return fail(errorParam(e))
  }
}
