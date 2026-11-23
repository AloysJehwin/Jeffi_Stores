import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { hasService } from '@/lib/tenant-registry'
import { billingOverview } from '@controller/lib/billing/overview'
import { cancelAll, payNow } from '@controller/lib/billing/subscription'

export const dynamic = 'force-dynamic'

// The workspace's subscription: its lines, next charge and pending change (GET). pay_now on a halted subscription
// answers with a checkoutUrl; cancel ends everything at cycle end (a store closes from Billing's close-store flow).
const Schema = z.object({ action: z.enum(['pay_now', 'cancel']) })

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json(await billingOverview(ctx.tenant.id))
}

export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const { tenant, owner } = ctx
  const payer = { email: owner.email, name: owner.name }
  try {
    if (parsed.data.action === 'pay_now') {
      const r = await payNow(tenant.id, payer)
      return NextResponse.json({ ...(await billingOverview(tenant.id)), checkoutUrl: r.status === 'checkout' ? r.checkoutUrl : null })
    }
    if (hasService(tenant, 'store')) return NextResponse.json({ error: 'Close the store from Billing to end its subscription.' }, { status: 409 })
    await cancelAll(tenant.id, payer)
    return NextResponse.json(await billingOverview(tenant.id))
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'Nothing is overdue.') return NextResponse.json({ error: msg }, { status: 409 })
    console.error('[billing:subscription]', msg)
    return NextResponse.json({ error: 'Could not update your subscription. Please try again.' }, { status: 502 })
  }
}
