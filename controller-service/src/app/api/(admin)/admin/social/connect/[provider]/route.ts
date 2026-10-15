import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { buildOAuthUrl } from '@/lib/catalog/meta'
import { signAdminState } from '@/lib/shared/oauth-state'
import { oauthProviderInfo, oauthRedirectUri } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

// Store-admin "Connect Facebook/Instagram". Signs a state carrying the tenant and sends the user to
// the Meta OAuth dialog, which returns to the fixed platform redirect URI registered on the Meta app.
// Both providers use the same Facebook Login flow (IG posts through the linked Page).
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const admin = await requireAdminScope(request, 'campaigns:write')
  if (admin instanceof NextResponse) return admin
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const { provider } = await params
  if (provider !== 'facebook' && provider !== 'instagram') {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  if (!oauthProviderInfo('meta').enabled) {
    const back = `${await currentAdminBaseUrlAsync()}/admin/social-posts`
    return NextResponse.redirect(`${back}?connected=0&provider=meta&error=not_configured`)
  }

  const state = signAdminState({ tenantId: tenant.tenantId, provider, nonce: crypto.randomBytes(8).toString('hex') })
  return NextResponse.redirect(buildOAuthUrl(oauthRedirectUri('meta'), state))
}
