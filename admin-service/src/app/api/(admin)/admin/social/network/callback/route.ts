import { NextRequest } from 'next/server'
import { verifyAdminState, returnToAdmin } from '@/lib/shared/oauth-state'
import { tenantAdminBase, errorParam } from '@/lib/integrations/oauth'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { saveNetworkAccount } from '@/lib/social/accounts'
import { NETWORKS, providerFor, type Network } from '@/lib/social/providers'
import { pkceVerifier, socialRedirectUri } from '@/lib/social/oauth'

export const dynamic = 'force-dynamic'

// One callback for every non-Meta network: cookieless and cross-site, trusted through the signed
// state. Saves the tokens as pending; the admin then picks the page, board or channel. When the
// sign-in reaches exactly one target it is chosen straight away.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const rawState = params.get('state')
  const state = rawState ? verifyAdminState(rawState) : null
  const backTo = `${await tenantAdminBase(state)}/admin/social-posts?tab=accounts`
  const fail = (reason: string) => returnToAdmin(`${backTo}&connected=0&error=${reason}`)
  const err = params.get('error_description') || params.get('error')
  if (err) return fail(errorParam(err))
  const network = state?.provider?.startsWith('social:') ? (state.provider.slice(7) as Network) : null
  if (!state || !network || !(NETWORKS as readonly string[]).includes(network)) return fail('bad_state')
  const oauth = providerFor(network).oauth
  const code = params.get('code')
  if (!oauth || !code) return fail('missing_params')
  try {
    const tokens = await oauth.exchange(code, socialRedirectUri(), pkceVerifier(state.nonce))
    const tenantId = state.tenantId === PLATFORM_TENANT_ID ? null : state.tenantId
    const targets = await oauth.listTargets(tokens.accessToken).catch(() => [])
    await saveNetworkAccount(tenantId, network, tokens, targets.length === 1 ? targets[0] : null)
    return returnToAdmin(`${backTo}&connected=1&network=${network}${targets.length === 1 ? '' : '&pick=1'}`)
  } catch (e) {
    return fail(errorParam(e))
  }
}
