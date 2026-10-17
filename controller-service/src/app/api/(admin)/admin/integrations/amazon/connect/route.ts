import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthProviderInfo, oauthRedirectUri } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

// Store-admin "Connect Amazon Seller" (SP-API website authorization). Signs a state carrying the
// tenant, then sends the seller to Seller Central's consent page. Amazon returns to the fixed
// platform redirect URI, which must be registered on the SP-API app.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const tenant = { tenantId: await credentialOwnerId() }

  const info = oauthProviderInfo('amazon_seller')
  if (!info.enabled) {
    const back = `${await currentAdminBaseUrlAsync()}/admin/amazon`
    return NextResponse.redirect(`${back}?connected=0&provider=amazon&error=not_configured`)
  }

  const state = signAdminState({
    tenantId: tenant.tenantId,
    provider: 'amazon_seller',
    nonce: crypto.randomBytes(8).toString('hex'),
  })

  const host = process.env.AMAZON_SELLER_CENTRAL_URL || 'https://sellercentral.amazon.in'
  const url = new URL('/apps/authorize/consent', host)
  url.searchParams.set('application_id', process.env.AMAZON_SP_APP_ID!)
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', oauthRedirectUri('amazon_seller'))
  if (process.env.AMAZON_SP_APP_DRAFT === 'true') url.searchParams.set('version', 'beta')

  return NextResponse.redirect(url.toString())
}
