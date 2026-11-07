import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { listingsGet, listingsReport, listingsSave } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'

/** Every sellable unit with its AJIO listing. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:read'), 'ajio:read', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return listingsGet('ajio')
}

/** Saves mappings typed in the table. */
export async function PUT(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:write'), 'ajio:write', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return listingsSave(request, 'ajio', admin)
}

/** ?action=report: a SKU report upload (preview, or apply=1). */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:write'), 'ajio:write', 'AJIO')
  if (admin instanceof NextResponse) return admin
  if (request.nextUrl.searchParams.get('action') !== 'report') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  return listingsReport(request, 'ajio', admin)
}
