import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { loadInsights } from '@/lib/social/data'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:read')
  if (admin instanceof NextResponse) return admin
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 30))
  return NextResponse.json(await loadInsights(await resolveTenantId(), days))
}
