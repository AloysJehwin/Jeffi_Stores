import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { pauseShowcase, publishShowcase, setShowcaseRenew } from '@/lib/showcase/store'
import { goLiveShowcase, payShowcaseNow, type ShowcaseCharge } from '@controller/lib/showcase/billing'
import { consoleShowcase, showcaseConsoleState } from '@controller/lib/showcase/state'

export const dynamic = 'force-dynamic'

// The console's Showcase page: the site's status and hosting (GET); publish, pause, resume, auto-renew and Pay now
// (POST { action }). Every answer is the page's fresh state.

const Schema = z.object({ action: z.enum(['publish', 'pause', 'resume', 'renew_on', 'renew_off', 'pay']) })

function failed(r: Extract<ShowcaseCharge, { ok: false }>) {
  if (r.code === 'wallet' || r.code === 'no_wallet') return NextResponse.json({ error: r.error, topUpUrl: '/dashboard/wallet' }, { status: 402 })
  return NextResponse.json({ error: r.error }, { status: r.code === 'not_found' ? 404 : 409 })
}

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const site = await consoleShowcase(ctx.owner.id, ctx.tenant.id)
  if (!site) return NextResponse.json({ error: 'No Showcase site yet.' }, { status: 404 })
  return NextResponse.json(await showcaseConsoleState(site))
}

export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const site = await consoleShowcase(ctx.owner.id, ctx.tenant.id)
  if (!site || site.ownerId !== ctx.owner.id) return NextResponse.json({ error: 'No Showcase site yet.' }, { status: 404 })

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
  const fresh = await consoleShowcase(ctx.owner.id, ctx.tenant.id)
  return NextResponse.json(await showcaseConsoleState(fresh ?? site))
}
