import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { listConnections } from '@/lib/social/data'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ networks: await listConnections(await resolveTenantId()) })
}
