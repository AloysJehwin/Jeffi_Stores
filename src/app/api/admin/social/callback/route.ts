import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { getCurrentTenant } from '@/lib/tenant-context'
import { currentAdminBaseUrlAsync } from '@/lib/brand'
import { saveTenantSocialAccount } from '@/lib/tenant-registry'
import { exchangeCodeForToken, getLongLivedToken, getPageAndIgAccounts } from '@/lib/meta'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyAdminState } from '@/app/api/admin/integrations/state'

export const dynamic = 'force-dynamic'

// Meta OAuth callback (store admin). Verifies the signed state, re-checks the admin session + that
// the state's tenant matches the request's ALS tenant, exchanges the code for a long-lived Page
// token, resolves the Page + linked IG account, encrypts + persists it. Redirects to the
// store-admin social-posts page with a toast param.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const backTo = `${await currentAdminBaseUrlAsync()}/admin/social-posts`

  const err = params.get('error')
  if (err) return NextResponse.redirect(`${backTo}?connected=0&error=${encodeURIComponent(err)}`)

  const code = params.get('code')
  const rawState = params.get('state')
  if (!code || !rawState) return NextResponse.redirect(`${backTo}?connected=0&error=missing_params`)

  const state = verifyAdminState(rawState)
  if (!state) return NextResponse.redirect(`${backTo}?connected=0&error=bad_state`)

  const admin = await requireAdminScope(request, 'campaigns:write')
  if (admin instanceof NextResponse) return NextResponse.redirect(`${backTo}?connected=0&error=not_authorized`)
  const tenant = getCurrentTenant()
  if (!tenant || tenant.tenantId !== state.tenantId) {
    return NextResponse.redirect(`${backTo}?connected=0&error=tenant_mismatch`)
  }

  try {
    const redirectUri = `${await currentAdminBaseUrlAsync()}/api/admin/social/callback`
    const shortToken = await exchangeCodeForToken(code, redirectUri)
    const { token: longToken, expiresInSec } = await getLongLivedToken(shortToken)
    const accounts = await getPageAndIgAccounts(longToken)

    const tokenExpiry = new Date(Date.now() + expiresInSec * 1000)
    await saveTenantSocialAccount({
      tenantId: state.tenantId, provider: 'facebook',
      pageId: accounts.pageId, pageName: accounts.pageName,
      accessTokenEnc: encryptToken(accounts.pageAccessToken), tokenExpiry,
    })
    if (accounts.igUserId) {
      await saveTenantSocialAccount({
        tenantId: state.tenantId, provider: 'instagram',
        pageId: accounts.pageId, pageName: accounts.pageName, igUserId: accounts.igUserId,
        accessTokenEnc: encryptToken(accounts.pageAccessToken), tokenExpiry,
      })
    }

    return NextResponse.redirect(`${backTo}?connected=meta`)
  } catch (e: any) {
    return NextResponse.redirect(`${backTo}?connected=0&error=${encodeURIComponent(e?.message?.slice(0, 80) || 'exchange_failed')}`)
  }
}
