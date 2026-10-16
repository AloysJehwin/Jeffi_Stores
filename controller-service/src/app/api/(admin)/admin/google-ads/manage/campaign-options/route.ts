import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { DEMAND_GEN_MIN_DAILY_FALLBACK } from '@/lib/google-ads/campaign-spec'
import { demandGenMinimumDaily, listAudiences } from '@/lib/google-ads/image-ads'
import { adsErrorResponse, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Live figures the wizard needs for Demand Gen: Google's daily minimum in the account currency and
// the account's audiences (optional targeting).
export async function GET(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  try {
    const ads = await googleAdsClientFor()
    const currency = (await queryOne<{ c: string | null }>(`SELECT currency_code AS c FROM ads_account WHERE id = 1`).catch(() => null))?.c || 'INR'
    const [minimum, audiences] = await Promise.all([
      demandGenMinimumDaily(ads, currency),
      listAudiences(ads).then(
        list => ({ list, error: null as string | null }),
        e => ({ list: [], error: String(e?.message ?? e).slice(0, 300) })
      ),
    ])
    return NextResponse.json({
      currency,
      demandGenMinimum: minimum ?? DEMAND_GEN_MIN_DAILY_FALLBACK,
      demandGenMinimumFromGoogle: minimum != null,
      audiences: audiences.list,
      audiencesError: audiences.error,
    })
  } catch (e) {
    return adsErrorResponse(e)
  }
}
