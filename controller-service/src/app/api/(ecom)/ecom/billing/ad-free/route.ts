import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { adFreeState } from '@controller/lib/ecom/ad-free-state'
import { clearRequestedAddon } from '@/lib/billing/requested-addons'
import { addLine, removeLine } from '@controller/lib/billing/subscription'

export const dynamic = 'force-dynamic'

// The ad-free add-on is a line on the workspace's subscription. add: an increase answers with a checkoutUrl the owner
// approves (it starts then); remove: ends with the paid cycle; decline_request: "Not now" on a signup pick.
const Schema = z.object({ action: z.enum(['add', 'remove', 'decline_request']) })

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
  const { tenant, owner } = ctx
  if (tenant.status !== 'active') return NextResponse.json({ error: 'Your store is not live yet.' }, { status: 409 })
  const payer = { email: owner.email, name: owner.name }

  let checkoutUrl: string | null = null
  try {
    if (parsed.data.action === 'add') {
      const r = await addLine(tenant.id, { kind: 'ad_free' }, payer)
      checkoutUrl = r.status === 'checkout' ? r.checkoutUrl : null
      await clearRequestedAddon(tenant.id, 'ad_free')
    } else if (parsed.data.action === 'remove') {
      await removeLine(tenant.id, { kind: 'ad_free' }, payer)
    } else {
      await clearRequestedAddon(tenant.id, 'ad_free')
    }
  } catch (e: any) {
    console.error('[billing:ad-free]', e?.message || e)
    return NextResponse.json({ error: 'Could not update your subscription. Please try again.' }, { status: 502 })
  }
  return NextResponse.json({ ...(await adFreeState(tenant.id)), ...(checkoutUrl ? { checkoutUrl } : {}) })
}
