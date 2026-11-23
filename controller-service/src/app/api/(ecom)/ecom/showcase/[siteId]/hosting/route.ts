import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { getOwnedShowcase, pauseShowcase, publishShowcase, setShowcaseRenew } from '@/lib/showcase/store'
import { goLiveShowcase, payShowcaseNow, type ShowcaseCharge } from '@controller/lib/showcase/billing'
import { showcaseConsoleState } from '@controller/lib/showcase/state'

export const dynamic = 'force-dynamic'

// One Showcase site's console page: its status and hosting (GET); publish, pause, resume, auto-renew and Pay now
// (POST { action }). Only the site's owner; every answer is the page's fresh state.

const Schema = z.object({ action: z.enum(['publish', 'pause', 'resume', 'renew_on', 'renew_off', 'pay']) })

function failed(r: Extract<ShowcaseCharge, { ok: false }>) {
  if (r.code === 'wallet' || r.code === 'no_wallet') return NextResponse.json({ error: r.error, topUpUrl: '/dashboard/wallet' }, { status: 402 })
  return NextResponse.json({ error: r.error }, { status: r.code === 'not_found' ? 404 : 409 })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Params = { params: Promise<{ siteId: string }> }
const owned = async (siteId: string, ownerId: string) => (UUID_RE.test(siteId) ? getOwnedShowcase(siteId, ownerId) : null)
const NOT_FOUND = () => NextResponse.json({ error: 'That site could not be found.' }, { status: 404 })

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const site = await owned((await params).siteId, ctx.owner.id)
  if (!site) return NOT_FOUND()
  return NextResponse.json(await showcaseConsoleState(site))
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const site = await owned((await params).siteId, ctx.owner.id)
  if (!site) return NOT_FOUND()

  const action = parsed.data.action
  if (action === 'publish') {
    const r = await publishShowcase(site.id)
    if (!r.ok && r.code !== 'payment_due') return NextResponse.json({ error: r.error }, { status: 409 })
    if (!r.ok) {
      const live = await goLiveShowcase(site.id)
      if (!live.ok) return failed(live)
    }
  } else if (action === 'resume') {
    const r = await goLiveShowcase(site.id)
    if (!r.ok) return failed(r)
  } else if (action === 'pause') {
    await pauseShowcase(site.id, 'owner')
  } else if (action === 'pay') {
    const r = await payShowcaseNow(site.id)
    if (!r.ok) return failed(r)
  } else {
    await setShowcaseRenew(site.id, action === 'renew_on')
  }
  const fresh = await getOwnedShowcase(site.id, ctx.owner.id)
  return NextResponse.json(await showcaseConsoleState(fresh ?? site))
}
