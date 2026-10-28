import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import type { Resolution } from '@/lib/admin/draft-merge'
import { homepageDraftIdFrom, homepageDraftOr, homepageLockFrom, noHomepageDraft, publishHomepageDraft } from '@/lib/catalog/homepage-draft'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ resolutions: z.record(z.string(), z.unknown()).optional() }).passthrough()

// POST ?draft=<id> — merge that draft into the live homepage. 409 DRAFT_CONFLICT lists fields
// another published draft also changed; resend with { resolutions } to settle them.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const draftId = homepageDraftIdFrom(request)
  if (!draftId) return noHomepageDraft()
  const body = bodySchema.safeParse(await request.json().catch(() => ({})))
  const resolutions = (body.success ? body.data.resolutions : undefined) as Record<string, Resolution> | undefined

  let published: Awaited<ReturnType<typeof publishHomepageDraft>>
  try {
    const lock = homepageLockFrom(admin, request)
    published = await publishHomepageDraft(draftId, { ...lock, resolutions })
  } catch (err) {
    try {
      return homepageDraftOr(err)
    } catch {
      console.error('[homepage-draft publish]', err)
      return NextResponse.json({ error: 'Publish failed; the live homepage was not changed.' }, { status: 500 })
    }
  }

  revalidatePath('/')
  revalidatePath('/business')
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'homepage',
    entityId: draftId,
    summary: 'Published a homepage draft',
    metadata: { revision: published.revision },
    request,
  }).catch(() => {})

  return NextResponse.json({ success: true, published })
}
