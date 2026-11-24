import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { getOwnedShowcase, pauseShowcase, publishShowcase } from '@/lib/showcase/store'
import { addShowcaseToSubscription, goLiveShowcase, payShowcaseNow, type ShowcaseCharge } from '@controller/lib/showcase/billing'
import { showcaseConsoleState } from '@controller/lib/showcase/state'
import { applyChange } from '@controller/lib/billing/subscription'

export const dynamic = 'force-dynamic'

// One Showcase site's console page: its status and hosting (GET); publish, pause, resume, autopay and Pay now
// (POST { action }). Only the site's owner. Hosting is a line on the workspace's subscription: when the owner has to
// approve it, the answer is 402 with a checkoutUrl. Otherwise every answer is the page's fresh state.

const Schema = z.object({ action: z.enum(['publish', 'pause', 'resume', 'autopay', 'renew_on', 'renew_off', 'pay']) })

function failed(r: Extract<ShowcaseCharge, { ok: false }>) {
  if (r.code === 'checkout') return NextResponse.json({ error: r.error, checkoutUrl: r.checkoutUrl ?? null }, { status: 402 })
  if (r.code === 'no_wallet') return NextResponse.json({ error: r.error }, { status: 402 })
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
  let r: ShowcaseCharge | null = null
  if (action === 'publish') {
    const p = await publishShowcase(site.id)
    if (!p.ok && p.code !== 'payment_due') return NextResponse.json({ error: p.error }, { status: 409 })
    if (!p.ok) r = await goLiveShowcase(site.id)
  } else if (action === 'resume') r = await goLiveShowcase(site.id)
  else if (action === 'pause') await pauseShowcase(site.id, 'owner')
  else if (action === 'pay') r = await payShowcaseNow(site.id)
  else if (action === 'autopay' || action === 'renew_on') r = await addShowcaseToSubscription(site.id)
  else if (site.tenantId) {
    // renew_off: the site leaves the subscription at the end of the paid cycle.
    await applyChange(site.tenantId, { remove: [{ kind: 'showcase_site', ref: site.id }] }, { email: ctx.owner.email, name: ctx.owner.name })
  }
  if (r && !r.ok) return failed(r)
  const fresh = await getOwnedShowcase(site.id, ctx.owner.id)
  return NextResponse.json(await showcaseConsoleState(fresh ?? site))
}
