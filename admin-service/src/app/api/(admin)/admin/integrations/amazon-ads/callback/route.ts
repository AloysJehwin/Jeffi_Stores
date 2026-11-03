import { NextRequest } from 'next/server'
import { verifyAdminState, returnToAdmin } from '@/lib/shared/oauth-state'
import { oauthRedirectUri, tenantAdminBase, errorParam } from '@/lib/integrations/oauth'
import { LWA_TOKEN, saveAmazonAdsConfig } from '@/lib/amazon-ads/client'

export const dynamic = 'force-dynamic'

// Amazon Ads OAuth callback: cookieless and cross-site, trusted through the signed state. Stores
// the refresh token with no profile yet; the owner picks the profile on the Amazon Ads page.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const rawState = params.get('state')
  const state = rawState ? verifyAdminState(rawState) : null
  const backTo = `${await tenantAdminBase(state)}/admin/amazon-ads`
  const fail = (reason: string) => returnToAdmin(`${backTo}?connected=0&error=${reason}`)
  const err = params.get('error_description') || params.get('error')
  if (err) return fail(errorParam(err))
  if (!state || state.provider !== 'amazon_ads') return fail('bad_state')
  const code = params.get('code')
  if (!code) return fail('missing_params')
  try {
    const res = await fetch(LWA_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: oauthRedirectUri('amazon_ads'),
        client_id: process.env.AMAZON_ADS_CLIENT_ID ?? '',
        client_secret: process.env.AMAZON_ADS_CLIENT_SECRET ?? '',
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.refresh_token) return fail(errorParam(data?.error_description || data?.error || 'exchange_failed'))
    await saveAmazonAdsConfig(state.tenantId, { refresh_token: data.refresh_token, connected_via: 'oauth' })
    return returnToAdmin(`${backTo}?connected=1&pick=1`)
  } catch (e) {
    return fail(errorParam(e))
  }
}
