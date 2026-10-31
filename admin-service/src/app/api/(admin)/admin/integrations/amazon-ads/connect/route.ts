import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthProviderInfo, oauthRedirectUri } from '@/lib/integrations/oauth'
import { AMAZON_ADS_SCOPE, LWA_AUTHORIZE, amazonAdsTenantKey } from '@/lib/amazon-ads/client'

export const dynamic = 'force-dynamic'

// "Connect with Amazon" for Amazon Ads. The advertising profile is picked after consent.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'amazon_ads:write')
  if (admin instanceof NextResponse) return admin
  const back = `${await currentAdminBaseUrlAsync()}/admin/amazon-ads`
  if (!oauthProviderInfo('amazon_ads').enabled) return NextResponse.redirect(`${back}?connected=0&error=not_configured`)
  const state = signAdminState({
    tenantId: await amazonAdsTenantKey(),
    provider: 'amazon_ads',
    nonce: crypto.randomBytes(8).toString('hex'),
    returnBase: await currentAdminBaseUrlAsync(),
  })
  const url = new URL(LWA_AUTHORIZE)
  url.searchParams.set('client_id', process.env.AMAZON_ADS_CLIENT_ID!)
  url.searchParams.set('scope', AMAZON_ADS_SCOPE)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', oauthRedirectUri('amazon_ads'))
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
