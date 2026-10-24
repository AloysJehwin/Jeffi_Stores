import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { HOMEPAGE_SURFACES, type HomepageSurface } from '@/lib/catalog/homepage-sections'
import { copySurfaceLayout, SurfaceNotEmpty, withHomepageDraft } from '@/lib/catalog/homepage-draft'

export const dynamic = 'force-dynamic'

const surface = z.enum(HOMEPAGE_SURFACES as [string, ...string[]])
const bodySchema = z.object({
  from: surface.default('web'),
  to: surface,
  replace: z.boolean().optional(),
})

// POST /api/admin/homepage-draft/copy — "Start from the website layout": copies one surface's sections
// and hero slides onto another in the draft, with fresh ids. 409 when the target already has rows and
// `replace` is not set.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(bodySchema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const { from, to, replace } = parsed.data
  if (from === to) return NextResponse.json({ error: 'Pick two different layouts' }, { status: 400 })

  try {
    const copied = await withHomepageDraft(admin.adminId, draft =>
      copySurfaceLayout(draft, from as HomepageSurface, to as HomepageSurface, { replace })
    )
    return NextResponse.json({ copied })
  } catch (err) {
    if (err instanceof SurfaceNotEmpty) {
      return NextResponse.json({ error: 'That layout already has its own sections or slides', code: 'not_empty' }, { status: 409 })
    }
    throw err
  }
}
