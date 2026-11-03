import { NextRequest, NextResponse } from 'next/server'
import { INVOICES_ENTITY, INVOICE_FIELDS, canonicalQuery, filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadInvoiceOverview } from '@/lib/overviews/invoices'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'invoices:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  // The list's filters; the invoice date is the period itself.
  const q = normalizeQuery(INVOICES_ENTITY, sp)
  const scope = filterScope(INVOICES_ENTITY, q, { omit: ['invoiced'] })
  try {
    return NextResponse.json(
      await loadInvoiceOverview(period, scope, canonicalQuery(q, INVOICE_FIELDS, { omit: ['from', 'to'] }))
    )
  } catch (err) {
    console.error('[invoices/overview]', err)
    return NextResponse.json({ error: 'Failed to load invoices overview' }, { status: 500 })
  }
}
