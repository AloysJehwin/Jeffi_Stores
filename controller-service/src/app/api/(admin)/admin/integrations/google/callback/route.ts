import { NextRequest } from 'next/server'
import { saveIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyAdminState, returnToAdmin } from '@/lib/shared/oauth-state'
import { oauthRedirectUri, tenantAdminBase, errorParam } from '@/lib/integrations/oauth'
import { completeGoogleAdsOAuth } from '@/lib/google-ads/oauth-callback'

export const dynamic = 'force-dynamic'

// Google OAuth callback (Merchant Center; Google Ads is dispatched on the state's provider).
// Cross-site return to the platform OAuth host (no admin cookie): trust comes from the signed
// state. Stores the refresh token + merchant id on the state's tenant.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const rawState = params.get('state')
  const state = rawState ? verifyAdminState(rawState) : null
  // One Google redirect URI serves Merchant Center and Google Ads; the signed state says which.
  if (state?.provider === 'google_ads') return completeGoogleAdsOAuth(params, state)
  const backTo = `${await tenantAdminBase(state)}/admin/merchant-sync`
  const fail = (reason: string) => returnToAdmin(`${backTo}?connected=0&provider=google&error=${reason}`)

  const err = params.get('error')
  if (err) return fail(errorParam(err))
  if (!state || state.provider !== 'google_merchant' || !state.merchantId) return fail('bad_state')
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
        redirect_uri: oauthRedirectUri('google_merchant'),
        grant_type: 'authorization_code',
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.refresh_token) {
      return fail(errorParam(data?.error_description || data?.error || 'no_refresh_token'))
    }
    if (typeof data.scope === 'string' && !data.scope.includes('auth/content')) return fail('scope_not_granted')

    await saveIntegrationCredential({
      tenantId: state.tenantId,
      provider: 'google_merchant',
      label: 'Google Merchant Center',
      configEnc: encryptToken(
        JSON.stringify({ oauth_refresh_token: data.refresh_token, merchant_id: state.merchantId })
      ),
      meta: { merchant_id: state.merchantId, connected_via: 'oauth' },
    })
    return returnToAdmin(`${backTo}?connected=google`)
  } catch (e) {
    return fail(errorParam(e))
  }
}
