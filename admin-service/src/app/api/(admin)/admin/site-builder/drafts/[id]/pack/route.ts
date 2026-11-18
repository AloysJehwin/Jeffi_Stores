import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { applySitePack } from '@/lib/site/apply-pack'
import { SiteDocInvalid } from '@/lib/site/store'
import { applyThemeToDraft } from '@/lib/site/themes/apply'
import { THEME_PACK_PREFIX } from '@/lib/site/themes/catalog'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const Body = z.object({ packId: z.string().max(80) })

// POST { packId }: apply a site pack to the draft: every page it has (desktop and phone) and its theme. Live only on publish.
// A ready-made theme comes as `theme:<style>.<palette>` (lib/site/themes): its pages and palette, the same way.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Pick a site pack' }, { status: 400 })
  try {
    const { packId } = parsed.data
    const applied = packId.startsWith(THEME_PACK_PREFIX)
      ? await applyThemeToDraft((await params).id, packId.slice(THEME_PACK_PREFIX.length), admin.adminId).then(r => r && { pages: r.pages, audience: 'store' as const })
      : await applySitePack((await params).id, packId, admin.adminId)
    if (!applied) return NextResponse.json({ error: 'Unknown site pack' }, { status: 404 })
    return NextResponse.json(applied)
  } catch (err) {
    if (err instanceof SiteDocInvalid) return NextResponse.json({ error: err.message, issues: err.issues }, { status: 400 })
    if (err instanceof Error && err.message === 'Draft not found') return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}
