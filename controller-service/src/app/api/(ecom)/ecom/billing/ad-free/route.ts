import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { buyAdFreeMonth, setAdFreeRenew } from '@/lib/billing/ad-free'
import { adFreeState } from '@controller/lib/ecom/ad-free-state'
import { clearRequestedAddon } from '@/lib/billing/requested-addons'

export const dynamic = 'force-dynamic'

const Schema = z.object({ action: z.enum(['buy', 'renew_on', 'renew_off', 'decline_request']) })

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json(await adFreeState(ctx.tenant.id))
}

export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const { tenant } = ctx
  if (tenant.status !== 'active') return NextResponse.json({ error: 'Your store is not live yet.' }, { status: 409 })

  if (parsed.data.action === 'buy') {
    const r = await buyAdFreeMonth(tenant.id, { renew: true, reason: 'purchase' })
    if (!r.ok) return NextResponse.json({ error: r.error, topUpUrl: '/dashboard/wallet' }, { status: 402 })
    await clearRequestedAddon(tenant.id, 'ad_free')
  } else if (parsed.data.action === 'decline_request') {
    // "Not now" on an add-on picked during signup.
    await clearRequestedAddon(tenant.id, 'ad_free')
  } else {
    await setAdFreeRenew(tenant.id, parsed.data.action === 'renew_on')
  }
  return NextResponse.json(await adFreeState(tenant.id))
}
