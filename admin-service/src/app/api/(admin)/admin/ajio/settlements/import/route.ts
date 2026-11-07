import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { settlementsImport } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** A settlement report: preview with the saved column mapping, or commit=1 to import. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:write'), 'ajio:write', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return settlementsImport(request, 'ajio', admin)
}
