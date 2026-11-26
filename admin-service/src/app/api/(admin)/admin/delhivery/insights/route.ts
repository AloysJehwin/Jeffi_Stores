import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS = ['all', 'in_transit', 'delivered', 'rto']
const BASE = "o.awb_number IS NOT NULL AND o.status NOT IN ('draft', 'cancelled')"
const RTO = "o.shipment_status LIKE 'rto%'"
const TRANSIT = "(o.shipment_status IS NULL OR (o.shipment_status <> 'delivered' AND o.shipment_status NOT LIKE 'rto%'))"
const WHERE: Record<string, string> = {
  all: BASE,
  in_transit: `${BASE} AND ${TRANSIT}`,
  delivered: `${BASE} AND o.shipment_status = 'delivered'`,
  rto: `${BASE} AND ${RTO}`,
}

/** Shipments handed to Delhivery per day by state, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'delhivery:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, FILTERS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries({
      table: 'orders',
      alias: 'o',
      dateColumn: 'shipped_at',
      where: WHERE[q.filter!],
      series: [
        { key: 'in_transit', label: 'In transit', where: TRANSIT },
        { key: 'delivered', label: 'Delivered', where: "o.shipment_status = 'delivered'" },
        { key: 'rto', label: 'Returned (RTO)', where: RTO },
      ],
      weeks: q.weeks,
      filter: q.filter,
    }),
    })
  } catch (err) {
    console.error('[delhivery insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
