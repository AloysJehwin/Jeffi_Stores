import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { resolveTenantId } from '@/lib/tenant-context'
import { currentAdminBaseUrlAsync } from '@/lib/brand'
import { saveIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyAdminState, returnToAdmin } from '@/lib/oauth-state'

export const dynamic = 'force-dynamic'

// Amazon LWA (SP-API) OAuth callback (store admin). Verifies the signed state, re-checks the admin
// session + that the state's tenant matches the request's ALS tenant, exchanges the spapi_oauth_code
// for a refresh token, encrypts + persists it with the LWA client credentials and the seller/
// marketplace ids Amazon carries back. Redirects to the store-admin merchant-sync page.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const backTo = `${await currentAdminBaseUrlAsync()}/admin/merchant-sync`

  const err = params.get('error')
  if (err) return returnToAdmin(`${backTo}?connected=0&error=${encodeURIComponent(err)}`)

  const code = params.get('spapi_oauth_code')
  const rawState = params.get('state')
  if (!code || !rawState) return returnToAdmin(`${backTo}?connected=0&error=missing_params`)

  const state = verifyAdminState(rawState)
  if (!state || state.provider !== 'amazon_seller') {
    return returnToAdmin(`${backTo}?connected=0&error=bad_state`)
  }

  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return returnToAdmin(`${backTo}?connected=0&error=not_authorized`)
  const tenantId = await resolveTenantId()
  if (tenantId !== state.tenantId) {
    return returnToAdmin(`${backTo}?connected=0&error=tenant_mismatch`)
  }

  try {
    const clientId = process.env.AMAZON_LWA_APP_CLIENT_ID
    const clientSecret = process.env.AMAZON_LWA_APP_CLIENT_SECRET
    if (!clientId || !clientSecret) return returnToAdmin(`${backTo}?connected=0&error=not_configured`)

    const body = new URLSearchParams({
      grant_type: 'authorization_code', code,
      client_id: clientId, client_secret: clientSecret,
    })
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.refresh_token) {
      const reason = data?.error_description || data?.error || 'exchange_failed'
      return returnToAdmin(`${backTo}?connected=0&error=${encodeURIComponent(String(reason).slice(0, 80))}`)
    }

    const sellerId = params.get('selling_partner_id') || ''
    const marketplaceId = params.get('marketplace_id') || 'A21TJRUUN4KGV'
    const normalized = {
      client_id: clientId, client_secret: clientSecret,
      refresh_token: data.refresh_token,
      seller_id: sellerId, marketplace_id: marketplaceId,
    }

    await saveIntegrationCredential({
      tenantId: state.tenantId,
      provider: 'amazon_seller',
      label: 'Amazon Seller',
      configEnc: encryptToken(JSON.stringify(normalized)),
      meta: { seller_id: sellerId, marketplace_id: marketplaceId, connected_via: 'oauth' },
    })

    return returnToAdmin(`${backTo}?connected=amazon`)
  } catch (e: any) {
    return returnToAdmin(`${backTo}?connected=0&error=${encodeURIComponent(e?.message?.slice(0, 80) || 'exchange_failed')}`)
  }
}
