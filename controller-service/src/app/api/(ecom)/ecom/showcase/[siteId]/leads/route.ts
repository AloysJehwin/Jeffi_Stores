import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { getOwnedShowcase, listShowcaseLeads, markShowcaseLeadsRead } from '@/lib/showcase/store'

export const dynamic = 'force-dynamic'

// One Showcase site's enquiries inbox, for its owner: newest first (?offset=&unread=1), and marking them read or unread.

const PAGE = 50
const Schema = z.object({ action: z.enum(['read', 'unread']), ids: z.union([z.literal('all'), z.array(z.uuid()).min(1).max(200)]) })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Params = { params: Promise<{ siteId: string }> }
const owned = async (siteId: string, ownerId: string) => (UUID_RE.test(siteId) ? getOwnedShowcase(siteId, ownerId) : null)
const NOT_FOUND = () => NextResponse.json({ error: 'That site could not be found.' }, { status: 404 })

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const site = await owned((await params).siteId, ctx.owner.id)
  if (!site) return NOT_FOUND()
  const sp = request.nextUrl.searchParams
  const offset = Math.max(0, Number(sp.get('offset')) || 0)
  return NextResponse.json({ ...(await listShowcaseLeads(site.id, { limit: PAGE, offset, unread: sp.get('unread') === '1' })), pageSize: PAGE })
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Pick the enquiries to mark.' }, { status: 400 })
  const site = await owned((await params).siteId, ctx.owner.id)
  if (!site) return NOT_FOUND()
  const changed = await markShowcaseLeadsRead(site.id, parsed.data.ids, parsed.data.action === 'read')
  return NextResponse.json({ ok: true, changed })
}
