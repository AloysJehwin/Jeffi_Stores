import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { NETWORKS, providerFor, type Network } from '@/lib/social/providers'
import { pkceChallenge, pkceVerifier, socialRedirectUri } from '@/lib/social/oauth'

export const dynamic = 'force-dynamic'

// Sign in to Business Profile, YouTube, Pinterest, LinkedIn or X. The state carries the network
// and store; the PKCE verifier is derived from its nonce on the callback.
export async function GET(request: NextRequest, { params }: { params: Promise<{ network: string }> }) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const base = await currentAdminBaseUrlAsync()
  const back = `${base}/admin/social-posts?tab=accounts`
  const network = (await params).network as Network
  const oauth = (NETWORKS as readonly string[]).includes(network) ? providerFor(network).oauth : undefined
  if (!oauth) return NextResponse.redirect(`${back}&connected=0&error=unknown_network`)
  if (oauth.env.some(k => !process.env[k]) || !process.env.CRON_SECRET) return NextResponse.redirect(`${back}&connected=0&error=not_configured`)
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = signAdminState({ tenantId: (await resolveTenantId()) ?? PLATFORM_TENANT_ID, provider: `social:${network}`, nonce, returnBase: base })
  return NextResponse.redirect(oauth.authorizeUrl(socialRedirectUri(), state, pkceChallenge(pkceVerifier(nonce))))
}
