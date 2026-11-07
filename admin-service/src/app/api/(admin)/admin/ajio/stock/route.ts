import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { stockGet, stockPush, stockSettingsPut } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Our stock vs what was pushed to AJIO, errors and price drift. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:read'), 'ajio:read', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return stockGet('ajio')
}

/** Push now. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:write'), 'ajio:write', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return stockPush('ajio', admin)
}

/** The safety buffer. */
export async function PUT(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:write'), 'ajio:write', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return stockSettingsPut(request, 'ajio', admin)
}
