import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { normalizeReferralCode, resolveReferralCode } from '@/lib/referrals/codes'
import { setReferralCookie } from '@/lib/referrals/cookie'
import { isReferralLive } from '@/lib/referrals/settings'

export const dynamic = 'force-dynamic'

// A shared link lands here. Only a visitor who goes on to create an account can be credited, so a
// signed-in customer is sent home without the cookie, as is any link that no longer resolves.
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params
  const home = request.nextUrl.clone()
  home.pathname = '/'
  home.search = ''

  try {
    const code = normalizeReferralCode(rawCode)
    if (!code || !(await isReferralLive()) || (await authenticateUser(request))) return NextResponse.redirect(home)
    if (!(await resolveReferralCode(code))) return NextResponse.redirect(home)

    const signup = request.nextUrl.clone()
    signup.pathname = '/signup'
    signup.search = '?ref=1'
    const res = NextResponse.redirect(signup)
    setReferralCookie(res, code)
    return res
  } catch {
    return NextResponse.redirect(home)
  }
}
