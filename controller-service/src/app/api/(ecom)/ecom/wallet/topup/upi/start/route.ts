import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { handleUpiStart } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

// Ecom wallet top-up by UPI, paid to the platform (its PhonePe, else its UPI ID).
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return handleUpiStart(request, { kind: 'owner', ownerId: ctx.owner.id, tenant: ctx.tenant }, { returnPrefix: '/ecom' })
}
