import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { renderProductIssues } from '@/lib/merchant/console-api'

export const dynamic = 'force-dynamic'

const TTL_HOURS = 6

/** Google's explanation and fix links for one product's issues, cached for a few hours. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const admin = await withPlan(await requireAdminScope(request, 'merchant_sync:read'), 'merchant_sync:read', 'Google Merchant')
  if (admin instanceof NextResponse) return admin
  const offerId = decodeURIComponent((await params).offerId)
  if (!offerId || offerId.length > 200) return NextResponse.json({ error: 'Invalid offer' }, { status: 400 })
  const fresh = request.nextUrl.searchParams.get('fresh') === '1'
  try {
    if (!fresh) {
      const cached = await queryOne<{ rendered: unknown; fetched_at: string }>(
        `SELECT rendered, fetched_at FROM gmc_issue_cache WHERE offer_id = $1 AND fetched_at > now() - make_interval(hours => $2)`,
        [offerId, TTL_HOURS]
      )
      if (cached) return NextResponse.json({ issues: cached.rendered, fetchedAt: cached.fetched_at, cached: true })
    }
    const issues = await renderProductIssues(offerId)
    await query(
      `INSERT INTO gmc_issue_cache (offer_id, rendered, fetched_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (offer_id) DO UPDATE SET rendered = EXCLUDED.rendered, fetched_at = now()`,
      [offerId, JSON.stringify(issues)]
    )
    return NextResponse.json({ issues, fetchedAt: new Date().toISOString(), cached: false })
  } catch (e) {
    return channelError(e, 'Connect Google Merchant Center first.')
  }
}
