import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { num, periodArgs } from '@/lib/overviews/catalog'
import { OFFERS_SQL, OFFER_TOTALS_SQL, offerAttention, offerCounts, toOfferRow } from '@/lib/overviews/offers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'coupons:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const args = periodArgs(period, previous)

  try {
    const [raw, totals] = await Promise.all([
      queryMany<Record<string, unknown>>(OFFERS_SQL, args),
      queryMany<Record<string, unknown>>(OFFER_TOTALS_SQL, args),
    ])
    const rows = raw.map(toOfferRow)
    const c = offerCounts(rows)
    const t = (cur: boolean) => {
      const r = totals.find(x => x.cur === cur)
      return { sales: num(r?.sales), offerSales: num(r?.offer_sales), offerOrders: num(r?.offer_orders) }
    }
    return NextResponse.json({
      period,
      previous,
      counts: {
        live: c.live,
        scheduled: c.scheduled,
        ended: c.ended,
        hidden: c.hidden,
        expiring: c.expiring.length,
        productsOnOffer: c.productsOnOffer,
      },
      current: t(true),
      previousStats: t(false),
      offers: rows
        .filter(r => r.status !== 'hidden' || r.sales > 0)
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10),
      attention: offerAttention(rows),
    })
  } catch (err) {
    console.error('[offers/overview]', err)
    return NextResponse.json({ error: 'Failed to load offers overview' }, { status: 500 })
  }
}
