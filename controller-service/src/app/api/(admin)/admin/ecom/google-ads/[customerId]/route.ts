import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { formatCustomerId, isValidCustomerId } from '@/lib/google-ads/client'
import { managerClient } from '@/lib/google-ads/credentials'
import { unlinkManagedAccount } from '@controller/lib/google-ads/manager-view'
import { adsErrorResponse } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Platform admins: unlink a client from the manager account (stores using it through the manager are disconnected).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const { customerId } = await params
  if (!isValidCustomerId(customerId)) return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 })
  const mgr = managerClient()
  if (!mgr) return NextResponse.json({ error: 'The platform manager account is not configured.' }, { status: 503 })
  try {
    const { disconnected } = await unlinkManagedAccount(mgr, customerId)
    await logAdminAudit({
      adminId: admin.adminId,
      action: 'delete',
      entityType: 'system',
      entityId: null,
      summary: `Unlinked Google Ads ${formatCustomerId(customerId)} from the platform manager${disconnected.length ? `; disconnected ${disconnected.map(s => s.name).join(', ')}` : ''}`,
      request,
    })
    return NextResponse.json({ ok: true, disconnected })
  } catch (e) {
    if (e instanceof Error && !('httpStatus' in e)) return NextResponse.json({ error: e.message }, { status: 400 })
    return adsErrorResponse(e)
  }
}
