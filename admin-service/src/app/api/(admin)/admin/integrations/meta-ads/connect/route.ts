import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthRedirectUri } from '@/lib/integrations/oauth'
import { buildOAuthUrl, findMetaConfig } from '@/lib/catalog/meta'
import { metaAdsTenantKey } from '@/lib/meta-ads/client'

export const dynamic = 'force-dynamic'

// "Connect with Facebook" for Meta Ads (ads scopes, separate from the Page connection for posting), with
// the store's own Meta app when it has one, else the platform's.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'meta_ads:write')
  if (admin instanceof NextResponse) return admin
  const back = `${await currentAdminBaseUrlAsync()}/admin/meta-ads`
  const tenantId = await metaAdsTenantKey()
  const cfg = await findMetaConfig(tenantId)
  if (!cfg || !process.env.CRON_SECRET) return NextResponse.redirect(`${back}?connected=0&error=not_configured`)
  const state = signAdminState({
    tenantId,
    provider: 'meta_ads',
    nonce: crypto.randomBytes(8).toString('hex'),
    returnBase: await currentAdminBaseUrlAsync(),
    metaApp: cfg.source,
  })
  return NextResponse.redirect(buildOAuthUrl(cfg, oauthRedirectUri('meta_ads'), state, 'ads'))
}
