import { NextRequest } from 'next/server'
import { sameHostRedirect } from '@/lib/shared/redirect'
import { authenticateUser } from '@/lib/auth/jwt'
import { normalizeReferralCode, resolveReferralCode } from '@/lib/referrals/codes'
import { setReferralCookie } from '@/lib/referrals/cookie'
import { isReferralLive } from '@/lib/referrals/settings'

export const dynamic = 'force-dynamic'

// A shared link lands here. Only a visitor who goes on to create an account can be credited, so a
// signed-in customer is sent home without the cookie, as is any link that no longer resolves.
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params

  try {
    const code = normalizeReferralCode(rawCode)
    if (!code || !(await isReferralLive()) || (await authenticateUser(request))) return sameHostRedirect('/')
    if (!(await resolveReferralCode(code))) return sameHostRedirect('/')

    const res = sameHostRedirect('/signup?ref=1')
    setReferralCookie(res, code)
    return res
  } catch {
    return sameHostRedirect('/')
  }
}
