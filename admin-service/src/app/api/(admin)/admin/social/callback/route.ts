import { NextRequest } from 'next/server'
import { exchangeCodeForToken, getLongLivedToken, getMetaConfig, getMetaUser, listMetaPages } from '@/lib/catalog/meta'
import { clearPendingPagePick, saveMetaPage, savePendingPagePick } from '@/lib/social/meta-connect'
import { verifyAdminState, returnToAdmin } from '@/lib/shared/oauth-state'
import { oauthRedirectUri, tenantAdminBase, errorParam } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

// Meta OAuth callback. Cross-site return to the platform OAuth host (no admin cookie): trust comes
// from the signed state, which also names the Meta app the dialog was opened with. Exchanges the code
// for a long-lived user token and lists the user's Pages (a Page token does not expire when derived
// from a long-lived user token). One Page is saved straight away; with several, the store picks one.
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
    const cfg = await getMetaConfig(state.tenantId, state.metaApp ?? 'platform')
    const shortToken = await exchangeCodeForToken(code, oauthRedirectUri('meta'), cfg)
    const { token: longToken } = await getLongLivedToken(shortToken, cfg)
    const [user, pages] = await Promise.all([getMetaUser(longToken), listMetaPages(longToken)])
    if (!pages.length) return fail(errorParam('No Facebook Page found on this account (a Page is required to post)'))
    const signIn = { fbUserId: user.id, granted: user.granted }
    if (pages.length === 1) {
      await saveMetaPage(state.tenantId, pages[0], signIn)
      await clearPendingPagePick(state.tenantId)
      return returnToAdmin(`${backTo}?connected=meta`)
    }
    await savePendingPagePick(state.tenantId, { ...signIn, userToken: longToken, metaApp: cfg.source })
    return returnToAdmin(`${backTo}?connected=meta&pick=1`)
  } catch (e) {
    return fail(errorParam(e))
  }
}
