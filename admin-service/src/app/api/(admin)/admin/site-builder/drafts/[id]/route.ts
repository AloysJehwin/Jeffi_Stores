import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS, SITE_AUDIENCES, SITE_SURFACES } from '@jeffi/site-blocks'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { discardSiteDraft, getSiteDraft, publishSiteDraft, saveDraftPage, saveDraftTheme, SiteDocInvalid } from '@/lib/site/store'
import { afterSiteChange } from '@/lib/site/after-publish'
import { saveStudioContext } from '@/lib/site/studio/context'
import { draftStudioContext } from '@/lib/site/studio/redesign'
import { requireAdminScope } from '@/lib/auth/jwt'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const Ref = z.object({
  audience: z.enum(SITE_AUDIENCES as [string, ...string[]]),
  surface: z.enum(SITE_SURFACES as [string, ...string[]]),
  page: z.enum(PAGE_KEYS),
  slug: z.string().max(120).regex(/^[a-z0-9-]*$/).optional(),
})
const Body = z.object({
  page: z.object({ ref: Ref, doc: z.unknown() }).optional(),
  theme: z.object({ audience: z.enum(SITE_AUDIENCES as [string, ...string[]]), tokens: z.record(z.string(), z.unknown()) }).optional(),
})

export async function GET(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  const draft = await getSiteDraft((await params).id)
  return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: 'Draft not found' }, { status: 404 })
}

/** Saves one page's document and/or a theme into the draft. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Send { page: { ref, doc } } or { theme: { audience, tokens } }' }, { status: 400 })
  try {
    const out: Record<string, unknown> = {}
    if (parsed.data.page) out.doc = await saveDraftPage(id, parsed.data.page.ref as never, parsed.data.page.doc, admin.adminId)
    if (parsed.data.theme) out.theme = await saveDraftTheme(id, parsed.data.theme.audience as never, parsed.data.theme.tokens, admin.adminId)
    return NextResponse.json(out)
  } catch (err) {
    if (err instanceof SiteDocInvalid) return NextResponse.json({ error: err.message, issues: err.issues }, { status: 400 })
    if (err instanceof Error && err.message === 'Draft not found') return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}

/** Publishes the draft. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  // An AI redesign's brief, plan and direction become the site's, so later AI changes follow the published design.
  const studio = await draftStudioContext(id)
  const published = await publishSiteDraft(id, admin.adminId)
  if (!published) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (studio) await saveStudioContext(studio).catch(err => console.warn('[site-builder] studio context not saved:', (err as Error).message))
  await afterSiteChange(request)
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'site_builder',
    entityId: id,
    summary: `Published a Site Builder draft (${published.pages.length} pages${published.theme.length ? ', theme' : ''})`,
    metadata: { pages: published.pages, conflicts: published.conflicts },
    request,
  }).catch(() => {})
  return NextResponse.json({ published })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const ok = await discardSiteDraft((await params).id)
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: 'Draft not found' }, { status: 404 })
}
