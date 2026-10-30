import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import {
  HOMEPAGE_AUDIENCES,
  HOMEPAGE_PAGES,
  HOMEPAGE_SURFACES,
  type HomepageAudience,
  type HomepagePage,
  type HomepageSurface,
} from '@/lib/catalog/homepage-sections'
import { getHomepagePlan, homepagePlanRefusal } from '@/lib/catalog/homepage-plan'
import { copySurfaceLayout, homepageLockFrom, SurfaceNotEmpty, withHomepageDraft, homepageDraftIdFrom, homepageDraftOr, noHomepageDraft } from '@/lib/catalog/homepage-draft'

export const dynamic = 'force-dynamic'

const surface = z.enum(HOMEPAGE_SURFACES as [string, ...string[]])
const audience = z.enum(HOMEPAGE_AUDIENCES as [string, ...string[]])
const bodySchema = z.object({
  from: surface.default('web'),
  to: surface,
  page: z.enum(HOMEPAGE_PAGES as [string, ...string[]]).default('home'),
  audience: audience.default('store'),
  fromAudience: audience.optional(),
  replace: z.boolean().optional(),
})

// POST /api/admin/homepage-draft/copy — "Start from the desktop layout" (or, for the business homepage,
// "Start from the store homepage"): copies one layout's sections on a page (and, for the homepage, its
// hero slides) onto another in the draft, with fresh ids. 409 when the target already has rows and
// `replace` is not set.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(bodySchema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const { from, to, page, replace } = parsed.data
  const target = parsed.data.audience as HomepageAudience
  const source = (parsed.data.fromAudience ?? target) as HomepageAudience
  if (from === to && source === target) return NextResponse.json({ error: 'Pick two different layouts' }, { status: 400 })
  if (target === 'business' && page !== 'home') {
    return NextResponse.json({ error: 'The business homepage has no listing pages' }, { status: 400 })
  }
  const refused = homepagePlanRefusal(await getHomepagePlan(), { audience: target })
  if (refused) return NextResponse.json({ error: refused }, { status: 403 })

  try {
    const draftId = homepageDraftIdFrom(request)
    if (!draftId) return noHomepageDraft()
    const copied = await withHomepageDraft(
      draftId,
      admin.adminId,
      draft =>
        copySurfaceLayout(draft, from as HomepageSurface, to as HomepageSurface, {
          page: page as HomepagePage,
          audience: target,
          fromAudience: source,
          replace,
        }),
      homepageLockFrom(admin, request)
    )
    return NextResponse.json({ copied })
  } catch (err) {
    if (err instanceof SurfaceNotEmpty) {
      return NextResponse.json({ error: 'That layout already has its own sections or slides', code: 'not_empty' }, { status: 409 })
    }
    return homepageDraftOr(err)
  }
}
