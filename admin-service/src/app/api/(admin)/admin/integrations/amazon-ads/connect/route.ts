import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthRedirectUri } from '@/lib/integrations/oauth'
import { resolveOAuthApp } from '@/lib/integrations/own-apps'
import { AMAZON_ADS_SCOPE, LWA_AUTHORIZE, amazonAdsTenantKey } from '@/lib/amazon-ads/client'

export const dynamic = 'force-dynamic'

// "Connect with Amazon" for Amazon Ads, with the store's own LWA app when it saved one, else the
// platform's. The advertising profile is picked after consent.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'amazon_ads:write')
  if (admin instanceof NextResponse) return admin
  const back = `${await currentAdminBaseUrlAsync()}/admin/amazon-ads`
  const tenantId = await amazonAdsTenantKey()
  const r = await resolveOAuthApp(tenantId, 'amazon_ads')
  if (!r || !process.env.CRON_SECRET) return NextResponse.redirect(`${back}?connected=0&error=not_configured`)
  const state = signAdminState({
    tenantId,
    provider: 'amazon_ads',
    nonce: crypto.randomBytes(8).toString('hex'),
    returnBase: await currentAdminBaseUrlAsync(),
    app: r.source,
  })
  const url = new URL(LWA_AUTHORIZE)
  url.searchParams.set('client_id', r.app.clientId)
  url.searchParams.set('scope', AMAZON_ADS_SCOPE)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', oauthRedirectUri('amazon_ads'))
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
