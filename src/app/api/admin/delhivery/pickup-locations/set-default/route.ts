import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { resolveTenantId } from '@/lib/tenant-context'
import { setDefaultPickupLocation } from '@/lib/delhivery'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const name = String(body?.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Warehouse name is required.' }, { status: 400 })

  const tenantId = (await resolveTenantId()) ?? undefined
  const result = await setDefaultPickupLocation(name, tenantId)
  if (!result.ok) return NextResponse.json({ error: result.error || 'Could not set default.' }, { status: 400 })

  return NextResponse.json({ ok: true, name })
}
