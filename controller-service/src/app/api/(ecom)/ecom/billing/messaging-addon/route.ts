import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { messagingAddonState } from '@controller/lib/ecom/messaging-addon-state'
import { clearRequestedAddon } from '@/lib/billing/requested-addons'
import { addLine, removeLine } from '@controller/lib/billing/subscription'

export const dynamic = 'force-dynamic'

// SMS & WhatsApp (one add-on for both channels, tier 'both') is a line on the workspace's subscription. add: an
// increase answers with a checkoutUrl; remove: ends with the paid cycle; decline_request: "Not now" on a signup pick.
const Schema = z.object({ action: z.enum(['add', 'remove', 'decline_request']) })

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json(await messagingAddonState(ctx.tenant.id))
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
      const r = await addLine(tenant.id, { kind: 'messaging_addon', ref: 'both' }, payer)
      checkoutUrl = r.status === 'checkout' ? r.checkoutUrl : null
      await clearRequestedAddon(tenant.id, 'messaging')
    } else if (parsed.data.action === 'remove') {
      await removeLine(tenant.id, { kind: 'messaging_addon', ref: 'both' }, payer)
    } else {
      await clearRequestedAddon(tenant.id, 'messaging')
    }
  } catch (e: any) {
    console.error('[billing:messaging-addon]', e?.message || e)
    return NextResponse.json({ error: 'Could not update your subscription. Please try again.' }, { status: 502 })
  }
  return NextResponse.json({ ...(await messagingAddonState(tenant.id)), ...(checkoutUrl ? { checkoutUrl } : {}) })
}
