import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants, saveIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyState } from '@/app/api/ecom/social/state'

export const dynamic = 'force-dynamic'

// Google OAuth callback for Merchant Center. Verifies the signed state, re-checks owner +
// ownership, exchanges the code for a refresh token (offline access), encrypts + persists it.
// OAuth alone does NOT yield a Merchant Center account id, so the credential is stored with
// meta.needs_merchant_id=true unless a merchant_id was carried through — the owner completes
// it via the paste form. On success redirects back to the integrations dashboard.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const backTo = `${baseUrl}/dashboard/integrations`

  const err = params.get('error')
  if (err) return NextResponse.redirect(`${backTo}?connected=0&reason=${encodeURIComponent(err)}`)

  const code = params.get('code')
  const rawState = params.get('state')
  if (!code || !rawState) return NextResponse.redirect(`${backTo}?connected=0&reason=missing_params`)

  const state = verifyState(rawState)
  if (!state || state.provider !== 'google_merchant') {
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
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) return NextResponse.redirect(`${backTo}?connected=0&reason=not_configured`)

    const redirectUri = `${baseUrl}/api/ecom/integrations/google/callback`
    const body = new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    })
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.refresh_token) {
      const reason = data?.error_description || data?.error || 'exchange_failed'
      return NextResponse.redirect(`${backTo}?connected=0&reason=${encodeURIComponent(String(reason).slice(0, 80))}`)
    }

    const merchantId = params.get('merchant_id') || ''
    const normalized: Record<string, any> = { oauth_refresh_token: data.refresh_token }
    if (merchantId) normalized.merchant_id = merchantId

    await saveIntegrationCredential({
      tenantId: state.tenantId,
      provider: 'google_merchant',
      label: 'Google Merchant Center',
      configEnc: encryptToken(JSON.stringify(normalized)),
      meta: merchantId
        ? { merchant_id: merchantId, connected_via: 'oauth' }
        : { connected_via: 'oauth', needs_merchant_id: true },
    })

    return NextResponse.redirect(`${backTo}?connected=google`)
  } catch (e: any) {
    return NextResponse.redirect(`${backTo}?connected=0&reason=${encodeURIComponent(e?.message?.slice(0, 80) || 'exchange_failed')}`)
  }
}
