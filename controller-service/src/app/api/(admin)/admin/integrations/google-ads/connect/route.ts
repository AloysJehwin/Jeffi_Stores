import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthProviderInfo, oauthRedirectUri } from '@/lib/integrations/oauth'
import { adsTenantKey, GOOGLE_ADS_SCOPE } from '@/lib/google-ads/credentials'
import { DATA_MANAGER_SCOPE } from '@/lib/google-ads/conversions/data-manager'

export const dynamic = 'force-dynamic'

// "Connect with Google" for Google Ads (flagship and tenants). The account is picked after
// consent on the Google Ads page, from the accounts this sign-in can reach. Asks for the Data
// Manager scope too (conversion uploads), incrementally; ?reconnect=1 keeps the chosen account.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin

  const back = `${await currentAdminBaseUrlAsync()}/admin/google-ads`
  if (!oauthProviderInfo('google_ads').enabled) {
    return NextResponse.redirect(`${back}?connected=0&provider=google_ads&error=not_configured`)
  }

  const state = signAdminState({
    tenantId: await adsTenantKey(),
    provider: 'google_ads',
    nonce: crypto.randomBytes(8).toString('hex'),
    returnBase: await currentAdminBaseUrlAsync(),
    ...(request.nextUrl.searchParams.get('reconnect') === '1' ? { keepAccount: true } : {}),
  })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_OAUTH_CLIENT_ID!)
  url.searchParams.set('redirect_uri', oauthRedirectUri('google_ads'))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', `${GOOGLE_ADS_SCOPE} ${DATA_MANAGER_SCOPE}`)
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
