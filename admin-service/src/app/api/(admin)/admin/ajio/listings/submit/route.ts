import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { listingTasksGet, listingsSubmit } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:read'), 'ajio:read', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return listingTasksGet('ajio')
}

/** Submits the picked units through the AJIO API (the sync cron polls the result). */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:write'), 'ajio:write', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return listingsSubmit(request, 'ajio', admin)
}
