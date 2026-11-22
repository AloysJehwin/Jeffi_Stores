import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { NETWORK_APP_FAMILY, resolveOAuthApp } from '@/lib/integrations/own-apps'
import { NETWORKS, providerFor, type Network } from '@/lib/social/providers'
import { pkceChallenge, pkceVerifier, socialRedirectUri } from '@/lib/social/oauth'

export const dynamic = 'force-dynamic'

// Sign in to Business Profile, YouTube, Pinterest, LinkedIn or X with the store's own app when it
// saved one, else the platform's. The state carries the network, store and app; the PKCE verifier
// is derived from its nonce on the callback.
export async function GET(request: NextRequest, { params }: { params: Promise<{ network: string }> }) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const base = await currentAdminBaseUrlAsync()
  const back = `${base}/admin/social-posts?tab=accounts`
  const network = (await params).network as Network
  const oauth = (NETWORKS as readonly string[]).includes(network) ? providerFor(network).oauth : undefined
  if (!oauth) return NextResponse.redirect(`${back}&connected=0&error=unknown_network`)
  const tenantId = await credentialOwnerId()
  const resolved = await resolveOAuthApp(tenantId, NETWORK_APP_FAMILY[network as keyof typeof NETWORK_APP_FAMILY])
  if (!resolved || !process.env.CRON_SECRET) return NextResponse.redirect(`${back}&connected=0&error=not_configured`)
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = signAdminState({ tenantId, provider: `social:${network}`, nonce, returnBase: base, app: resolved.source })
  return NextResponse.redirect(oauth.authorizeUrl(socialRedirectUri(), state, pkceChallenge(pkceVerifier(nonce)), resolved.app))
}
