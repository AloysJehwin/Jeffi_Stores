import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { exportFill, exportInspect } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** ?action=inspect reads the template's columns; otherwise fills it for the picked units. */
export async function POST(request: NextRequest) {
  const inspect = request.nextUrl.searchParams.get('action') === 'inspect'
  const admin = inspect
    ? await withPlan(await requireAdminScope(request, 'myntra:read'), 'myntra:read', 'Myntra')
    : await withPlan(await requireAdminScope(request, 'myntra:write'), 'myntra:write', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return inspect ? exportInspect(request, 'myntra') : exportFill(request, 'myntra', admin)
}
