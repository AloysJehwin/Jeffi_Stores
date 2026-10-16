import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthProviderInfo, oauthRedirectUri } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

const GMC_OAUTH_SCOPE = 'https://www.googleapis.com/auth/content'

// Store-admin "Connect Google Merchant Center" with Google sign-in. The merchant id is chosen
// before consent and carried in the signed state; the callback stores a refresh token for it.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const tenant = { tenantId: await credentialOwnerId() }

  const back = `${await currentAdminBaseUrlAsync()}/admin/merchant`
  const merchantId = (request.nextUrl.searchParams.get('merchant_id') || '').trim()
  if (!/^\d{5,20}$/.test(merchantId)) {
    return NextResponse.redirect(`${back}?connected=0&provider=google&error=invalid_merchant_id`)
  }
  if (!oauthProviderInfo('google_merchant').enabled) {
    return NextResponse.redirect(`${back}?connected=0&provider=google&error=not_configured`)
  }

  const state = signAdminState({
    tenantId: tenant.tenantId,
    provider: 'google_merchant',
    nonce: crypto.randomBytes(8).toString('hex'),
    merchantId,
  })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_OAUTH_CLIENT_ID!)
  url.searchParams.set('redirect_uri', oauthRedirectUri('google_merchant'))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GMC_OAUTH_SCOPE)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'select_account consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
