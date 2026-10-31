import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { awaitingSettlement } from '@/lib/payments/rzp-settlement-report'

export const dynamic = 'force-dynamic'

// GET — captured payments not yet settled, with the expected settlement date.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const account = await razorpayAccountFor()
  if (account.kind === 'route') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await awaitingSettlement(account.kind))
}
