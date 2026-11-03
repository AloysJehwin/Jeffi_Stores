import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { getTenantWallet } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const w = await getTenantWallet(ctx.tenant.id, 100)
  return NextResponse.json({ balance: w.balance, minBalance: w.minBalance, currency: w.currency, ledger: w.ledger })
}
