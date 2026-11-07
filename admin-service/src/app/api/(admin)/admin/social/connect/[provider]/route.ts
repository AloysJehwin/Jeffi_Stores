import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { buildOAuthUrl, findMetaConfig } from '@/lib/catalog/meta'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthRedirectUri } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

// Store-admin "Connect Facebook/Instagram". Signs a state carrying the tenant and the Meta app (the store's
// own, else the platform's) and sends the user to that app's Meta OAuth dialog, which returns to the fixed
// platform redirect URI. Both providers use the same Facebook Login flow (IG posts through the linked Page).
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const tenantId = await credentialOwnerId()

  const { provider } = await params
  if (provider !== 'facebook' && provider !== 'instagram') {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const cfg = await findMetaConfig(tenantId)
  if (!cfg || !process.env.CRON_SECRET) {
    const back = `${await currentAdminBaseUrlAsync()}/admin/social-posts`
    return NextResponse.redirect(`${back}?connected=0&provider=meta&error=not_configured`)
  }

  const state = signAdminState({ tenantId, provider, nonce: crypto.randomBytes(8).toString('hex'), metaApp: cfg.source })
  return NextResponse.redirect(buildOAuthUrl(cfg, oauthRedirectUri('meta'), state, 'social'))
}
