import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS: Record<string, string> = {
  all: '',
  b2b: 'NULLIF(TRIM(o.buyer_gstin), \'\') IS NOT NULL',
  b2c: 'NULLIF(TRIM(o.buyer_gstin), \'\') IS NULL',
}

/** Daily series behind the invoices issued insights pop-over on the invoices overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'invoices:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, Object.keys(FILTERS))
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'orders',
      alias: 'o',
      dateColumn: 'invoice_date',
      where: ['o.invoice_number IS NOT NULL AND o.source <> \'cash_sale\' AND o.status <> \'cancelled\'', FILTERS[q.filter as string]].filter(Boolean).join(' AND '),
      series: [
        { key: 'paid', label: 'Paid', where: 'o.payment_status = \'paid\'', value: 'SUM(o.total_amount)' },
        { key: 'outstanding', label: 'Outstanding', where: 'o.payment_status IN (\'unpaid\', \'partial\')', value: 'SUM(o.total_amount)' },
        { key: 'refunded', label: 'Refunded', where: 'o.payment_status = \'refunded\'', value: 'SUM(o.total_amount)' },
      ],
      top: { label: 'COALESCE(NULLIF(o.customer_name, \'\'), \'Customer\')', value: 'SUM(o.total_amount)' },
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
