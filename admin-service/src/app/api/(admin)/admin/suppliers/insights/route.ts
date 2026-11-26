import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS = ['orders', 'receipts']
/** Purchase orders and goods receipts per day, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inventory:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, FILTERS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries(q.filter === 'receipts'
        ? {
            table: 'grns',
            alias: 'g',
            dateColumn: 'received_date',
            dateKind: 'date',
            joins: 'LEFT JOIN suppliers s ON s.id = g.supplier_id',
            series: [{ key: 'receipts', label: 'Receipts' }],
            top: { label: 's.name' },
            weeks: q.weeks,
            filter: q.filter,
          }
        : {
            table: 'purchase_orders',
            alias: 'po',
            dateColumn: 'order_date',
            dateKind: 'date',
            joins: 'LEFT JOIN suppliers s ON s.id = po.supplier_id',
            series: [
              { key: 'draft', label: 'Draft', where: "po.status = 'draft'" },
              { key: 'open', label: 'Open', where: "po.status IN ('sent', 'partial')" },
              { key: 'received', label: 'Received', where: "po.status = 'received'" },
              { key: 'cancelled', label: 'Cancelled', where: "po.status = 'cancelled'" },
            ],
            top: { label: 's.name' },
            weeks: q.weeks,
            filter: q.filter,
          }),
    })
  } catch (err) {
    console.error('[suppliers insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
