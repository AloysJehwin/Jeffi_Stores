import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCurrentTenant } from '@/lib/tenant-context'
import { listDelhiveryPickupLocations } from '@/lib/delhivery'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'delhivery:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const locations = await listDelhiveryPickupLocations(getCurrentTenant()?.tenantId)
  return NextResponse.json({ locations })
}
