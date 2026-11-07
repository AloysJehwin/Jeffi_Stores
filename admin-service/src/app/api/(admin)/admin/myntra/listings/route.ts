import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { listingsGet, listingsReport, listingsSave } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'

/** Every sellable unit with its Myntra listing. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:read'), 'myntra:read', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return listingsGet('myntra')
}

/** Saves mappings typed in the table. */
export async function PUT(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:write'), 'myntra:write', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return listingsSave(request, 'myntra', admin)
}

/** ?action=report: a SKU report upload (preview, or apply=1). */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:write'), 'myntra:write', 'Myntra')
  if (admin instanceof NextResponse) return admin
  if (request.nextUrl.searchParams.get('action') !== 'report') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  return listingsReport(request, 'myntra', admin)
}
