import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'
import { getLoyaltyStats } from '@/lib/loyalty/queries'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { getReferralStats } from '@/lib/referrals/queries'
import { getReferralSettings } from '@/lib/referrals/settings'
import { byPeriod, num, periodArgs, str } from '@/lib/overviews/marketing'
import {
  LOYALTY_KPI_SQL,
  REDEEMABLE_SQL,
  REFERRAL_KPI_SQL,
  STALE_JOINED_SQL,
  TOP_EARNERS_SQL,
  TOP_REFERRERS_SQL,
  loyaltySeriesSql,
  programAttention,
  toLoyaltyTotals,
  toPerson,
  toReferralTotals,
} from '@/lib/overviews/customer-programs'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'campaigns:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const args = periodArgs(period, previous)

  try {
    const [loyaltySettings, referralSettings, loyaltyStats, referralStats] = await Promise.all([
      getLoyaltySettings(),
      getReferralSettings(),
      getLoyaltyStats(),
      getReferralStats(),
    ])
    const [lk, series, earners, rk, referrers, redeemable, stale] = await Promise.all([
      queryMany<Record<string, unknown>>(LOYALTY_KPI_SQL, args),
      queryMany<Record<string, unknown>>(loyaltySeriesSql(bucket), args),
      queryMany<Record<string, unknown>>(TOP_EARNERS_SQL, args),
      queryMany<Record<string, unknown>>(REFERRAL_KPI_SQL, args),
      queryMany<Record<string, unknown>>(TOP_REFERRERS_SQL, args),
      queryOne<Record<string, unknown>>(REDEEMABLE_SQL, [loyaltySettings.minRedeemPoints]),
      queryOne<Record<string, unknown>>(STALE_JOINED_SQL, [referralSettings.qualifyDays]),
    ])
    const loyalty = byPeriod(lk, toLoyaltyTotals)
    const referrals = byPeriod(rk, toReferralTotals)
    const liability = loyaltyStats.outstandingPoints * loyaltySettings.pointValue
    const facts = {
      loyaltyOn: loyaltySettings.enabled,
      referralsOn: referralSettings.enabled,
      liability,
      outstandingPoints: loyaltyStats.outstandingPoints,
      redeemableMembers: num(redeemable?.n),
      minRedeemPoints: loyaltySettings.minRedeemPoints,
      staleJoined: num(stale?.n),
      qualifyDays: referralSettings.qualifyDays,
    }
    return NextResponse.json({
      period,
      previous,
      bucket,
      loyalty: {
        enabled: loyaltySettings.enabled,
        point_value: loyaltySettings.pointValue,
        current: loyalty.current,
        previous: loyalty.previous,
        members: loyaltyStats.members,
        by_tier: loyaltyStats.byTier,
        outstanding_points: loyaltyStats.outstandingPoints,
        liability,
        redeemable_members: facts.redeemableMembers,
        series: series.map(r => ({ label: str(r.label), issued: num(r.issued), redeemed: num(r.redeemed) })),
        top_earners: earners.map(r => ({
          ...toPerson(r),
          earned: num(r.earned),
          redeemed: num(r.redeemed),
          points: num(r.points),
          tier: str(r.tier),
        })),
      },
      referrals: {
        enabled: referralSettings.enabled,
        current: referrals.current,
        previous: referrals.previous,
        all_time: referralStats,
        top_referrers: referrers.map(r => ({
          ...toPerson(r),
          signups: num(r.signups),
          rewarded: num(r.rewarded),
          revenue: num(r.revenue),
        })),
      },
      attention: programAttention(facts, loyalty.current, referrals.current),
    })
  } catch (err) {
    console.error('[customer-programs/overview]', err)
    return NextResponse.json({ error: 'Failed to load programs overview' }, { status: 500 })
  }
}
