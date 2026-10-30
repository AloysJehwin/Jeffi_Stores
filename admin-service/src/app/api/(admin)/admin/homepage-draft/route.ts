import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin, type AdminJWTPayload } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { parseBody } from '@/lib/shared/validate'
import { actorOf } from '@/lib/admin/draft-locks'
import {
  createHomepageDraft,
  discardHomepageDraft,
  getHomepageDraftSummary,
  homepageDraftIdFrom,
  homepageDraftOr,
  homepageLockFrom,
  noHomepageDraft,
} from '@/lib/catalog/homepage-draft'

export const dynamic = 'force-dynamic'

async function guard(request: NextRequest): Promise<AdminJWTPayload | NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return admin
}

// GET ?draft=<id> — what that draft changes, per page and layout.
export async function GET(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await getHomepageDraftSummary(homepageDraftIdFrom(request)))
}

// POST — start a new draft from live, locked to the caller.
export async function POST(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin
  const parsed = parseBody(z.object({ title: z.string().trim().max(120).nullish() }), await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const id = await createHomepageDraft(actorOf(admin), parsed.data.title)
  return NextResponse.json({ id }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin
  const draftId = homepageDraftIdFrom(request)
  if (!draftId) return noHomepageDraft()

  // Holder, or an owner role (audited); 423 for anyone else.
  const discarded = await discardHomepageDraft(draftId, homepageLockFrom(admin, request)).catch(homepageDraftOr)
  if (discarded instanceof NextResponse) return discarded
  if (discarded) {
    await logAdminAudit({
      adminId: admin.adminId,
      action: 'delete',
      entityType: 'homepage',
      entityId: draftId,
      summary: 'Discarded a homepage draft',
      request,
    }).catch(() => {})
  }
  return NextResponse.json({ success: true, discarded })
}
