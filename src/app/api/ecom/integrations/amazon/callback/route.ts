import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants, saveIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyState } from '@/app/api/ecom/social/state'

export const dynamic = 'force-dynamic'

// Amazon LWA (SP-API) OAuth callback. Verifies the signed state, re-checks owner + ownership,
// exchanges the spapi_oauth_code for a refresh token, encrypts + persists it alongside the LWA
// client credentials and the seller/marketplace ids Amazon carries back on the redirect. On
// success redirects back to the integrations dashboard.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const backTo = `${baseUrl}/dashboard/integrations`

  const err = params.get('error')
  if (err) return NextResponse.redirect(`${backTo}?connected=0&reason=${encodeURIComponent(err)}`)

  const code = params.get('spapi_oauth_code')
  const rawState = params.get('state')
  if (!code || !rawState) return NextResponse.redirect(`${backTo}?connected=0&reason=missing_params`)

  const state = verifyState(rawState)
  if (!state || state.provider !== 'amazon_seller') {
    return NextResponse.redirect(`${backTo}?connected=0&reason=bad_state`)
  }

  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner || owner.id !== state.ownerId) {
    return NextResponse.redirect(`${backTo}?connected=0&reason=not_signed_in`)
  }
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find((t) => t.id === state.tenantId)) {
    return NextResponse.redirect(`${backTo}?connected=0&reason=tenant_not_found`)
  }

  try {
    const clientId = process.env.AMAZON_LWA_APP_CLIENT_ID
    const clientSecret = process.env.AMAZON_LWA_APP_CLIENT_SECRET
    if (!clientId || !clientSecret) return NextResponse.redirect(`${backTo}?connected=0&reason=not_configured`)

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
      return NextResponse.redirect(`${backTo}?connected=0&reason=${encodeURIComponent(String(reason).slice(0, 80))}`)
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

    return NextResponse.redirect(`${backTo}?connected=amazon`)
  } catch (e: any) {
    return NextResponse.redirect(`${backTo}?connected=0&reason=${encodeURIComponent(e?.message?.slice(0, 80) || 'exchange_failed')}`)
  }
}
