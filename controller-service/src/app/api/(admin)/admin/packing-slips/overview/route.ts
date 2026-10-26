import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { eddSettingsFromValues } from '@/lib/shipping/edd'
import { parsePeriod } from '@/lib/overview/period'
import { loadPackingStrip } from '@/lib/overviews/packing-slips'
import { PACKING_ENTITY } from '@/lib/filters/entities/packing-slips'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'packing_slips:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    const handlingDays = eddSettingsFromValues(await getBusinessValues().catch(() => null)).handlingDays
    // The slips list's filters, except its date (the period owns from / to).
    const q = normalizeQuery(PACKING_ENTITY, sp)
    const scope = filterScope(PACKING_ENTITY, q, { omit: ['created'], ctx: { handlingDays } })
    return NextResponse.json(await loadPackingStrip(period, handlingDays, scope))
  } catch (err) {
    console.error('[packing-slips/overview]', err)
    return NextResponse.json({ error: 'Failed to load packing overview' }, { status: 500 })
  }
}
