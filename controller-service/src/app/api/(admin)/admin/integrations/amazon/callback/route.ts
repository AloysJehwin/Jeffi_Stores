import { NextRequest } from 'next/server'
import { saveIntegrationCredential, getIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { verifyAdminState, returnToAdmin } from '@/lib/shared/oauth-state'
import { oauthRedirectUri, tenantAdminBase, errorParam } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

// Amazon SP-API OAuth callback. Lands on the platform OAuth host, cross-site, so the SameSite=Strict
// admin cookie is absent: trust comes from the HMAC-signed state (issued only by the admin-gated
// connect route). Exchanges spapi_oauth_code for a refresh token and stores it on the state's tenant.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const rawState = params.get('state')
  const state = rawState ? verifyAdminState(rawState) : null
  const backTo = `${await tenantAdminBase(state)}/admin/amazon`
  const fail = (reason: string) => returnToAdmin(`${backTo}?connected=0&provider=amazon&error=${reason}`)

  const err = params.get('error_description') || params.get('error')
  if (err) return fail(errorParam(err))
  if (!state || state.provider !== 'amazon_seller') return fail('bad_state')
  const code = params.get('spapi_oauth_code')
  if (!code) return fail('missing_params')

  const clientId = process.env.AMAZON_LWA_APP_CLIENT_ID
  const clientSecret = process.env.AMAZON_LWA_APP_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail('not_configured')

  try {
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: oauthRedirectUri('amazon_seller'),
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.refresh_token) {
      return fail(errorParam(data?.error_description || data?.error || 'exchange_failed'))
    }

    // Amazon returns no marketplace; keep one the tenant set earlier, else India.
    let marketplaceId = 'A21TJRUUN4KGV'
    const existing = await getIntegrationCredential(state.tenantId, 'amazon_seller')
    if (existing) {
      try {
        marketplaceId = JSON.parse(decryptToken(existing.config_enc))?.marketplace_id || marketplaceId
      } catch {}
    }
    const sellerId = params.get('selling_partner_id') || ''
    await saveIntegrationCredential({
      tenantId: state.tenantId,
      provider: 'amazon_seller',
      label: 'Amazon Seller',
      configEnc: encryptToken(
        JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: data.refresh_token,
          seller_id: sellerId,
          marketplace_id: marketplaceId,
        })
      ),
      meta: { seller_id: sellerId, marketplace_id: marketplaceId, connected_via: 'oauth' },
    })
    return returnToAdmin(`${backTo}?connected=amazon`)
  } catch (e) {
    return fail(errorParam(e))
  }
}
