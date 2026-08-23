import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants, saveTenantSocialAccount } from '@/lib/tenant-registry'
import { exchangeCodeForToken, getLongLivedToken, getPageAndIgAccounts } from '@/lib/meta'
import { encryptToken } from '@/lib/crypto/token-cipher'
import { verifyState } from '@/app/api/ecom/social/state'

export const dynamic = 'force-dynamic'

// Meta OAuth callback. Verifies the signed state, re-checks owner + ownership, exchanges the
// code for a long-lived Page token, resolves the Page + linked IG account, encrypts the token
// and persists it. On success redirects the owner back to the billing/social dashboard.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const backTo = `${baseUrl}/dashboard/social`

  const err = params.get('error')
  if (err) return NextResponse.redirect(`${backTo}?connected=0&reason=${encodeURIComponent(err)}`)

  const code = params.get('code')
  const rawState = params.get('state')
  if (!code || !rawState) return NextResponse.redirect(`${backTo}?connected=0&reason=missing_params`)

  const state = verifyState(rawState)
  if (!state) return NextResponse.redirect(`${backTo}?connected=0&reason=bad_state`)

  // Re-authenticate the owner and re-verify ownership (never trust state alone for authz).
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner || owner.id !== state.ownerId) {
    return NextResponse.redirect(`${backTo}?connected=0&reason=not_signed_in`)
  }
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find((t) => t.id === state.tenantId)) {
    return NextResponse.redirect(`${backTo}?connected=0&reason=tenant_not_found`)
  }

  try {
    const redirectUri = `${baseUrl}/api/ecom/social/callback`
    const shortToken = await exchangeCodeForToken(code, redirectUri)
    const { token: longToken, expiresInSec } = await getLongLivedToken(shortToken)
    const accounts = await getPageAndIgAccounts(longToken)

    const tokenExpiry = new Date(Date.now() + expiresInSec * 1000)
    // Persist the Page (Facebook) — the Page token is what actually posts.
    await saveTenantSocialAccount({
      tenantId: state.tenantId, provider: 'facebook',
      pageId: accounts.pageId, pageName: accounts.pageName,
      accessTokenEnc: encryptToken(accounts.pageAccessToken), tokenExpiry,
    })
    // If the Page has a linked IG Business account, record it too (same Page token posts to IG).
    if (accounts.igUserId) {
      await saveTenantSocialAccount({
        tenantId: state.tenantId, provider: 'instagram',
        pageId: accounts.pageId, pageName: accounts.pageName, igUserId: accounts.igUserId,
        accessTokenEnc: encryptToken(accounts.pageAccessToken), tokenExpiry,
      })
    }

    const connectedIg = accounts.igUserId ? '1' : '0'
    return NextResponse.redirect(`${backTo}?connected=1&ig=${connectedIg}`)
  } catch (e: any) {
    return NextResponse.redirect(`${backTo}?connected=0&reason=${encodeURIComponent(e?.message?.slice(0, 80) || 'exchange_failed')}`)
  }
}
