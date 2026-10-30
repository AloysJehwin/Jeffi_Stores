import { NextRequest } from 'next/server'
import { saveTenantSocialAccount, deleteTenantSocialAccount } from '@/lib/tenant-registry'
import { exchangeCodeForToken, getLongLivedToken, getPageAndIgAccounts } from '@/lib/catalog/meta'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyAdminState, returnToAdmin } from '@/lib/shared/oauth-state'
import { oauthRedirectUri, tenantAdminBase, errorParam } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

// Meta OAuth callback. Cross-site return to the platform OAuth host (no admin cookie): trust comes
// from the signed state. Exchanges the code for a long-lived user token, resolves the Page (its
// token does not expire when derived from a long-lived user token) + linked IG account, and stores
// them on the state's tenant.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const rawState = params.get('state')
  const state = rawState ? verifyAdminState(rawState) : null
  const backTo = `${await tenantAdminBase(state)}/admin/social-posts`
  const fail = (reason: string) => returnToAdmin(`${backTo}?connected=0&provider=meta&error=${reason}`)

  const err = params.get('error_description') || params.get('error')
  if (err) return fail(errorParam(err))
  if (!state || (state.provider !== 'facebook' && state.provider !== 'instagram')) return fail('bad_state')
  const code = params.get('code')
  if (!code) return fail('missing_params')

  try {
    const shortToken = await exchangeCodeForToken(code, oauthRedirectUri('meta'))
    const { token: longToken } = await getLongLivedToken(shortToken)
    const accounts = await getPageAndIgAccounts(longToken)
    const accessTokenEnc = encryptToken(accounts.pageAccessToken)
    const base = { tenantId: state.tenantId, pageId: accounts.pageId, pageName: accounts.pageName, accessTokenEnc }

    await saveTenantSocialAccount({ ...base, provider: 'facebook', tokenExpiry: null })
    if (accounts.igUserId) {
      await saveTenantSocialAccount({
        ...base,
        provider: 'instagram',
        igUserId: accounts.igUserId,
        tokenExpiry: null,
      })
    } else {
      // The Page has no linked IG business account any more; drop a stale IG row.
      await deleteTenantSocialAccount(state.tenantId, 'instagram')
    }
    return returnToAdmin(`${backTo}?connected=meta`)
  } catch (e) {
    return fail(errorParam(e))
  }
}
