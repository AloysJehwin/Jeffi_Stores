import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { AD_FREE_PRICE_INR, buyAdFreeMonth, getAdFree, setAdFreeRenew } from '@/lib/billing/ad-free'
import { getWalletBalance } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

const Schema = z.object({ action: z.enum(['buy', 'renew_on', 'renew_off']) })

async function state(tenantId: string) {
  const [status, balance] = await Promise.all([getAdFree(tenantId), getWalletBalance(tenantId)])
  return { ...status, priceInr: AD_FREE_PRICE_INR, balanceInr: balance.balance }
}

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json(await state(ctx.tenant.id))
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
  } else {
    await setAdFreeRenew(tenant.id, parsed.data.action === 'renew_on')
  }
  return NextResponse.json(await state(tenant.id))
}
