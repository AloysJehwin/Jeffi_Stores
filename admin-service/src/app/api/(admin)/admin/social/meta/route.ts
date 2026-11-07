import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { readJson } from '@/lib/channels/route'
import { listMetaPages } from '@/lib/catalog/meta'
import { clearPendingPagePick, readPendingPagePick, saveMetaPage } from '@/lib/social/meta-connect'

export const dynamic = 'force-dynamic'

// The Page picker after a Facebook sign-in that can reach several Pages (the same pick=1 pattern as the
// Meta Ads ad account). The sign-in waits in the control-plane DB for 15 minutes.

async function gate(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return { error: admin }
  return { tenantId: await credentialOwnerId() }
}

export async function GET(request: NextRequest) {
  const g = await gate(request)
  if ('error' in g) return g.error
  const pending = await readPendingPagePick(g.tenantId)
  if (!pending) return NextResponse.json({ pages: null })
  try {
    const pages = await listMetaPages(pending.userToken)
    return NextResponse.json({ pages: pages.map(p => ({ id: p.pageId, name: p.pageName, instagram: !!p.igUserId })) })
  } catch (e: any) {
    return NextResponse.json({ pages: [], error: String(e?.message ?? e).slice(0, 200) })
  }
}

const Body = z.object({ pageId: z.string().regex(/^\d{1,30}$/, 'Choose a Page') })

export async function POST(request: NextRequest) {
  const g = await gate(request)
  if ('error' in g) return g.error
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const pending = await readPendingPagePick(g.tenantId)
  if (!pending) return NextResponse.json({ error: 'The Facebook sign-in expired. Connect with Facebook again.' }, { status: 409 })
  let page
  try {
    page = (await listMetaPages(pending.userToken)).find(p => p.pageId === parsed.data.pageId)
  } catch (e: any) {
    return NextResponse.json({ error: `Meta refused to list the Pages: ${String(e?.message ?? e).slice(0, 200)}` }, { status: 502 })
  }
  if (!page) return NextResponse.json({ error: 'That Page is not reachable with this sign-in.' }, { status: 400 })
  await saveMetaPage(g.tenantId, page, pending)
  await clearPendingPagePick(g.tenantId)
  return NextResponse.json({ ok: true, page_name: page.pageName, instagram: !!page.igUserId })
}

export async function DELETE(request: NextRequest) {
  const g = await gate(request)
  if ('error' in g) return g.error
  await clearPendingPagePick(g.tenantId)
  return NextResponse.json({ ok: true })
}
