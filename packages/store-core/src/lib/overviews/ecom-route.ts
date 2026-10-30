import { NextRequest, NextResponse } from 'next/server'
import type { Pool } from 'pg'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { controlPlanePool } from '@/lib/tenant-registry'
import { MAX_SPAN_DAYS, isDate, parsePeriod, spanDays, type Period } from '@/lib/overview/period'

/** Shared GET handler for the platform overviews: the page's read scope plus the platform-admin
 * check every /admin/ecom page uses, a validated ?from&to, and the control-plane pool. */
export async function ecomOverviewGet<T>(
  request: NextRequest,
  scope: string,
  run: (pool: Pool, period: Period, sp: URLSearchParams) => Promise<T>
) {
  const admin = await requireAdminScope(request, scope)
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if ((from || to) && !(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
    return NextResponse.json(
      { error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` },
      { status: 400 }
    )
  try {
    return NextResponse.json(await run(controlPlanePool(), parsePeriod(from, to), sp))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
