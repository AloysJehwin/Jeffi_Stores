import { NextRequest } from 'next/server'
import { verifyAdminState, returnToAdmin } from '@/lib/shared/oauth-state'
import { oauthRedirectUri, tenantAdminBase, errorParam } from '@/lib/integrations/oauth'
import { exchangeCodeForToken, getLongLivedToken } from '@/lib/catalog/meta'
import { readMetaAdsConfig, saveMetaAdsConfig } from '@/lib/meta-ads/client'

export const dynamic = 'force-dynamic'

// Meta Ads OAuth callback: cookieless and cross-site, trusted through the signed state. Stores a
// long-lived user token; the ad account is picked on the Meta Ads page. A pixel id set earlier is kept.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const rawState = params.get('state')
  const state = rawState ? verifyAdminState(rawState) : null
  const backTo = `${await tenantAdminBase(state)}/admin/meta-ads`
  const fail = (reason: string) => returnToAdmin(`${backTo}?connected=0&error=${reason}`)
  const err = params.get('error_description') || params.get('error_reason') || params.get('error')
  if (err) return fail(errorParam(err))
  if (!state || state.provider !== 'meta_ads') return fail('bad_state')
  const code = params.get('code')
  if (!code) return fail('missing_params')
  try {
    const short = await exchangeCodeForToken(code, oauthRedirectUri('meta_ads'))
    const { token, expiresInSec } = await getLongLivedToken(short)
    const prev = await readMetaAdsConfig(state.tenantId)
    await saveMetaAdsConfig(state.tenantId, {
      access_token: token,
      token_expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      pixel_id: prev?.pixel_id,
      capi_token: prev?.capi_token,
      connected_via: 'oauth',
    })
    return returnToAdmin(`${backTo}?connected=1&pick=1`)
  } catch (e) {
    return fail(errorParam(e))
  }
}
