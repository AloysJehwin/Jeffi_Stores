import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthRedirectUri } from '@/lib/integrations/oauth'
import { resolveOAuthApp } from '@/lib/integrations/own-apps'

export const dynamic = 'force-dynamic'

// Store-admin "Connect Amazon Seller" (SP-API website authorization). Signs a state carrying the
// tenant, then sends the seller to Seller Central's consent page. Amazon returns to the fixed
// platform redirect URI, which must be registered on the SP-API app. Uses the store's own SP-API
// app when it saved one, else the platform's.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const tenant = { tenantId: await credentialOwnerId() }

  const r = await resolveOAuthApp(tenant.tenantId, 'amazon_seller')
  if (!r?.app.applicationId || !process.env.CRON_SECRET) {
    const back = `${await currentAdminBaseUrlAsync()}/admin/amazon`
    return NextResponse.redirect(`${back}?connected=0&provider=amazon&error=not_configured`)
  }

  const state = signAdminState({
    tenantId: tenant.tenantId,
    provider: 'amazon_seller',
    nonce: crypto.randomBytes(8).toString('hex'),
    app: r.source,
  })

  const host = process.env.AMAZON_SELLER_CENTRAL_URL || 'https://sellercentral.amazon.in'
  const url = new URL('/apps/authorize/consent', host)
  url.searchParams.set('application_id', r.app.applicationId)
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', oauthRedirectUri('amazon_seller'))
  if (process.env.AMAZON_SP_APP_DRAFT === 'true') url.searchParams.set('version', 'beta')

  return NextResponse.redirect(url.toString())
}
