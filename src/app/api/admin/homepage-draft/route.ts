import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, type AdminJWTPayload } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { discardHomepageDraft, getHomepageDraftSummary } from '@/lib/catalog/homepage-draft'

export const dynamic = 'force-dynamic'

async function guard(request: NextRequest): Promise<AdminJWTPayload | NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return admin
}

export async function GET(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await getHomepageDraftSummary())
}

export async function DELETE(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin

  const discarded = await discardHomepageDraft()
  if (discarded) {
    await logAdminAudit({
      adminId: admin.adminId,
      action: 'delete',
      entityType: 'homepage',
      entityId: 'draft',
      summary: 'Discarded the homepage draft',
      request,
    }).catch(() => {})
  }
  return NextResponse.json({ success: true, discarded })
}
