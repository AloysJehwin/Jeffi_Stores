import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerOrderView, ownerStore } from '@controller/lib/domains/owner-api'
import { advanceOrder, cancelOrder, getOrder, setOrderAutoRenew } from '@controller/lib/domains/orders'
import { advanceRenewal, currentRenewal } from '@controller/lib/domains/renewal'

export const dynamic = 'force-dynamic'

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check') }),
  z.object({ action: z.literal('buy') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('renew') }),
  z.object({ action: z.literal('auto_renew'), on: z.boolean() }),
])

// POST {action}: check (advance when due, for the progress view), buy (a requested order, now), cancel
// (a requested order), renew (the open renewal, now, after a top-up) or auto_renew.
export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  const parsed = ActionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const order = /^[0-9a-f-]{36}$/i.test(orderId) ? await getOrder(orderId) : null
  if (!order) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  const auth = await ownerStore(request, order.tenant_id)
  if (auth instanceof NextResponse) return auth

  const a = parsed.data
  let out = order
  if (a.action === 'check') out = (await advanceOrder(order.id)) ?? order
  else if (a.action === 'buy') {
    if (order.status !== 'requested') return NextResponse.json({ error: 'This domain is already bought.' }, { status: 409 })
    out = (await advanceOrder(order.id, { force: true })) ?? order
    if (out.status === 'requested' && out.last_error) return NextResponse.json({ error: out.last_error, order: await ownerOrderView(out) }, { status: 402 })
  } else if (a.action === 'cancel') {
    if (order.status !== 'requested') return NextResponse.json({ error: 'Only a domain not yet bought can be cancelled.' }, { status: 409 })
    out = (await cancelOrder(order.id)) ?? order
  } else if (a.action === 'renew') {
    const r = await currentRenewal(order.id)
    if (!r || r.term_expires_at !== order.expires_at || !['due', 'renewing'].includes(r.status)) return NextResponse.json({ error: 'Nothing to renew right now.' }, { status: 409 })
    const after = await advanceRenewal(r.id, { force: true })
    out = (await getOrder(order.id)) ?? order
    if (after?.status === 'due' && after.last_error) return NextResponse.json({ error: after.last_error === 'wallet balance too low' ? `Your wallet needs ₹${(after.price_inr ?? 0).toLocaleString('en-IN')} to renew. Top up and try again.` : after.last_error, order: await ownerOrderView(out) }, { status: 402 })
  } else if (a.action === 'auto_renew') {
    if (!['active', 'configuring', 'registering'].includes(order.status)) return NextResponse.json({ error: 'This domain is not live.' }, { status: 409 })
    out = await setOrderAutoRenew(order.id, a.on)
  }
  return NextResponse.json({ ok: true, order: await ownerOrderView(out) })
}
