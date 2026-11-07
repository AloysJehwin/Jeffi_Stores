import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { listingTasksGet, listingsSubmit } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:read'), 'myntra:read', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return listingTasksGet('myntra')
}

/** Submits the picked units through the Myntra API (the sync cron polls the result). */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:write'), 'myntra:write', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return listingsSubmit(request, 'myntra', admin)
}
