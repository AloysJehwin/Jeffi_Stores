import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { getLoyaltySummary } from '@/lib/loyalty/queries'
import { reconcileLoyalty } from '@/lib/loyalty/reconcile'
import { isLoyaltyEligible } from '@/lib/loyalty/redeem'
import { getLoyaltySettings } from '@/lib/loyalty/settings'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authUser = await authenticateUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const settings = await getLoyaltySettings()
    if (!settings.enabled) return NextResponse.json({ enabled: false })
    if (!(await isLoyaltyEligible(authUser.userId))) return NextResponse.json({ enabled: true, eligible: false })

    await reconcileLoyalty({ userId: authUser.userId }).catch(err => {
      console.error('[loyalty] on-view reconcile failed', err)
    })
    const summary = await getLoyaltySummary(authUser.userId, settings)
    return NextResponse.json({
      enabled: true,
      eligible: true,
      ...summary,
      program: {
        rupeesPerPoint: settings.rupeesPerPoint,
        pointValue: settings.pointValue,
        minRedeemPoints: settings.minRedeemPoints,
        creditDelayDays: settings.creditDelayDays,
        tiers: settings.tiers,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
