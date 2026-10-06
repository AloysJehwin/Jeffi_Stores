import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { isLoyaltyEligible } from '@/lib/loyalty/redeem'
import { getOrCreateReferralCode } from '@/lib/referrals/codes'
import { getReferralSummary } from '@/lib/referrals/queries'
import { getReferralSettings, isReferralLive } from '@/lib/referrals/settings'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authUser = await authenticateUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    if (!(await isReferralLive())) return NextResponse.json({ enabled: false })
    if (!(await isLoyaltyEligible(authUser.userId))) return NextResponse.json({ enabled: true, eligible: false })

    const [settings, code] = await Promise.all([getReferralSettings(), getOrCreateReferralCode(authUser.userId)])
    if (!code) return NextResponse.json({ enabled: true, eligible: false })

    const page = Number(request.nextUrl.searchParams.get('page')) || 1
    const summary = await getReferralSummary(authUser.userId, settings, page)
    return NextResponse.json({
      enabled: true,
      eligible: true,
      code,
      program: {
        rewardPoints: settings.rewardPoints,
        yearlyCap: settings.yearlyCap,
        qualifyDays: settings.qualifyDays,
      },
      ...summary,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
