import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { stockGet, stockPush, stockSettingsPut } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Our stock vs what was pushed to Myntra, errors and price drift. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:read'), 'myntra:read', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return stockGet('myntra')
}

/** Push now. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:write'), 'myntra:write', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return stockPush('myntra', admin)
}

/** The safety buffer. */
export async function PUT(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:write'), 'myntra:write', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return stockSettingsPut(request, 'myntra', admin)
}
