import { NextRequest, NextResponse } from 'next/server'
import { emptyDoc, normalizeDoc, pageRefKey, parsePageRefKey, surfaceAllows, type PageDoc } from '@jeffi/site-blocks'
import { requireAdminScope } from '@/lib/auth/jwt'
import { upgradeCodeSections } from '@/lib/site/code/compile'
import { getPublishedPage, getSiteDraft, siteEditorEnabled } from '@/lib/site/store'

export const dynamic = 'force-dynamic'

// GET ?key=<audience:web:page:slug>: one page as the visual editor opens it (docs/plans/SITE_EDITOR_PLAN.md): the
// draft's version, else the published one, code sections as v2 trees. One responsive document per page: `phone` says
// whether the phone layout is that same document (the editor saves both), one of its own, or none (it follows desktop).
// Saving goes through PUT drafts/[id], which compiles every tree again.

const canon = (d: PageDoc) => JSON.stringify({ order: d.order, blocks: d.blocks }, (k, v) => (k === 'compiled' || k === 'tree' ? undefined : v))

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  if (!(await siteEditorEnabled())) return NextResponse.json({ error: 'The visual editor is not switched on for this store' }, { status: 404 })
  const draft = await getSiteDraft((await params).id)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  const ref = parsePageRefKey(request.nextUrl.searchParams.get('key') ?? '')
  if (!ref || ref.surface !== 'web') return NextResponse.json({ error: 'Open a desktop web page' }, { status: 400 })
  const own = (k: string) => draft.docs.pages?.[k]
  const doc = normalizeDoc(own(pageRefKey(ref)) ?? (await getPublishedPage(ref))?.doc ?? emptyDoc())
  const phoneRef = { ...ref, surface: 'web_mobile' as const }
  const phoneDoc = surfaceAllows('web_mobile', ref.page) ? (own(pageRefKey(phoneRef)) ?? (await getPublishedPage(phoneRef))?.doc ?? null) : null
  const phone = !phoneDoc ? 'none' : canon(normalizeDoc(phoneDoc)) === canon(doc) ? 'same' : 'own'
  return NextResponse.json({ doc: upgradeCodeSections(doc, ref.page), phone })
}
