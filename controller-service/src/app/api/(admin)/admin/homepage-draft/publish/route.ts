import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { publishHomepageDraft, type PublishResult } from '@/lib/catalog/homepage-draft'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let published: PublishResult | null
  try {
    published = await publishHomepageDraft()
  } catch (err) {
    console.error('[homepage-draft publish]', err)
    return NextResponse.json({ error: 'Publish failed; the live homepage was not changed.' }, { status: 500 })
  }
  if (!published) return NextResponse.json({ error: 'There are no draft changes to publish' }, { status: 409 })

  revalidatePath('/')
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'homepage',
    entityId: 'draft',
    summary: 'Published the homepage draft',
    metadata: { sections: published.sections, heroSlides: published.heroSlides },
    request,
  }).catch(() => {})

  return NextResponse.json({ success: true, published })
}
