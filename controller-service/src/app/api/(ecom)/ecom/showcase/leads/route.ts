import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { listShowcaseLeads, markShowcaseLeadsRead } from '@/lib/showcase/store'
import { consoleShowcase } from '@controller/lib/showcase/state'

export const dynamic = 'force-dynamic'

// The Showcase's enquiries inbox: newest first (?offset=&unread=1), and marking them read or unread.

const PAGE = 50
const Schema = z.object({ action: z.enum(['read', 'unread']), ids: z.union([z.literal('all'), z.array(z.uuid()).min(1).max(200)]) })

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const site = await consoleShowcase(ctx.owner.id, ctx.tenant.id)
  if (!site) return NextResponse.json({ error: 'No Showcase site yet.' }, { status: 404 })
  const sp = request.nextUrl.searchParams
  const offset = Math.max(0, Number(sp.get('offset')) || 0)
  return NextResponse.json({ ...(await listShowcaseLeads(site.id, { limit: PAGE, offset, unread: sp.get('unread') === '1' })), pageSize: PAGE })
}

export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Pick the enquiries to mark.' }, { status: 400 })
  const site = await consoleShowcase(ctx.owner.id, ctx.tenant.id)
  if (!site || site.ownerId !== ctx.owner.id) return NextResponse.json({ error: 'No Showcase site yet.' }, { status: 404 })
  const changed = await markShowcaseLeadsRead(site.id, parsed.data.ids, parsed.data.action === 'read')
  return NextResponse.json({ ok: true, changed })
}
