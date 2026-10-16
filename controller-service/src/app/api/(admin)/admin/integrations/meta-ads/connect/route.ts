import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthProviderInfo, oauthRedirectUri } from '@/lib/integrations/oauth'
import { GRAPH_VERSION, META_ADS_SCOPES, metaAdsTenantKey } from '@/lib/meta-ads/client'

export const dynamic = 'force-dynamic'

// "Connect with Facebook" for Meta Ads (ads scopes, separate from the Page connection for posting).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'meta_ads:write')
  if (admin instanceof NextResponse) return admin
  const back = `${await currentAdminBaseUrlAsync()}/admin/meta-ads`
  if (!oauthProviderInfo('meta_ads').enabled) return NextResponse.redirect(`${back}?connected=0&error=not_configured`)
  const state = signAdminState({ tenantId: await metaAdsTenantKey(), provider: 'meta_ads', nonce: crypto.randomBytes(8).toString('hex'), returnBase: await currentAdminBaseUrlAsync() })
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', process.env.META_APP_ID!)
  url.searchParams.set('redirect_uri', oauthRedirectUri('meta_ads'))
  url.searchParams.set('scope', META_ADS_SCOPES.join(','))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
