import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { lineLabels } from '@controller/lib/billing/lines'
import { migrationQuote, startMigration } from '@controller/lib/billing/migrate'

export const dynamic = 'force-dynamic'

// The switch from wallet-paid add-ons and sites to the subscription (/dashboard/billing/subscribe): what will be
// billed, the monthly total, the wallet credit for time already paid and the deadline (GET); POST starts the
// Razorpay checkout and answers with its checkoutUrl.

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const q = await migrationQuote(ctx.tenant.id)
  const label = await lineLabels(ctx.tenant.id, q.legacy)
  return NextResponse.json({
    legacy: q.legacy.map(l => ({ id: l.id, kind: l.kind, label: label(l), amountPaise: l.amountPaise, graceUntil: l.graceUntil })),
    quote: q.quote,
    creditInr: q.creditInr,
    deadline: q.deadline,
  })
}

export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const q = await migrationQuote(ctx.tenant.id)
  if (!q.legacy.length) return NextResponse.json({ error: 'Nothing is paid from the wallet any more.' }, { status: 409 })
  try {
    const r = await startMigration(ctx.tenant.id, { email: ctx.owner.email, name: ctx.owner.name })
    if (r.status !== 'checkout') return NextResponse.json({ error: 'Nothing to subscribe to.' }, { status: 409 })
    return NextResponse.json({ checkoutUrl: r.checkoutUrl })
  } catch (e: any) {
    console.error('[billing:subscribe]', e?.message || e)
    return NextResponse.json({ error: 'Could not start the subscription. Please try again.' }, { status: 502 })
  }
}
