import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { messagingAddonState } from '@controller/lib/ecom/messaging-addon-state'
import { buyMessagingAddonMonth, setMessagingAddonRenew } from '@/lib/billing/messaging-addon'

export const dynamic = 'force-dynamic'

const Schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('buy') }),
  z.object({ action: z.enum(['renew_on', 'renew_off']) }),
])

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
  const { tenant } = ctx
  if (tenant.status !== 'active') return NextResponse.json({ error: 'Your store is not live yet.' }, { status: 409 })

  if (parsed.data.action === 'buy') {
    // One add-on covers both channels.
    const r = await buyMessagingAddonMonth(tenant.id, { tier: 'both', renew: true, reason: 'purchase' })
    if (!r.ok) return NextResponse.json({ error: r.error, topUpUrl: '/dashboard/wallet' }, { status: 402 })
  } else {
    await setMessagingAddonRenew(tenant.id, parsed.data.action === 'renew_on')
  }
  return NextResponse.json(await messagingAddonState(tenant.id))
}
