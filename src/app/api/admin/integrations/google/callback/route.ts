import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { getCurrentTenant } from '@/lib/tenant-context'
import { currentAdminBaseUrl } from '@/lib/brand'
import { saveIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyAdminState } from '@/app/api/admin/integrations/state'

export const dynamic = 'force-dynamic'

// Google OAuth callback for Merchant Center (store admin). Verifies the signed state, re-checks
// the admin session + that the state's tenant matches the request's ALS tenant, exchanges the code
// for a refresh token, encrypts + persists it. OAuth alone yields no Merchant Center id, so the
// row is stored with meta.needs_merchant_id=true unless one was carried through — completed via
// the manual form. Redirects back to the store-admin merchant-sync page with a toast param.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const backTo = `${currentAdminBaseUrl()}/admin/merchant-sync`

  const err = params.get('error')
  if (err) return NextResponse.redirect(`${backTo}?connected=0&error=${encodeURIComponent(err)}`)

  const code = params.get('code')
  const rawState = params.get('state')
  if (!code || !rawState) return NextResponse.redirect(`${backTo}?connected=0&error=missing_params`)

  const state = verifyAdminState(rawState)
  if (!state || state.provider !== 'google_merchant') {
    return NextResponse.redirect(`${backTo}?connected=0&error=bad_state`)
  }

  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return NextResponse.redirect(`${backTo}?connected=0&error=not_authorized`)
  const tenant = getCurrentTenant()
  if (!tenant || tenant.tenantId !== state.tenantId) {
    return NextResponse.redirect(`${backTo}?connected=0&error=tenant_mismatch`)
  }

  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) return NextResponse.redirect(`${backTo}?connected=0&error=not_configured`)

    const redirectUri = `${currentAdminBaseUrl()}/api/admin/integrations/google/callback`
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
      return NextResponse.redirect(`${backTo}?connected=0&error=${encodeURIComponent(String(reason).slice(0, 80))}`)
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
    return NextResponse.redirect(`${backTo}?connected=0&error=${encodeURIComponent(e?.message?.slice(0, 80) || 'exchange_failed')}`)
  }
}
