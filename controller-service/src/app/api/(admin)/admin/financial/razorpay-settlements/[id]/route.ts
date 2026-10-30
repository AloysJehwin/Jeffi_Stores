import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { settlementDetail } from '@/lib/payments/rzp-settlement-report'

export const dynamic = 'force-dynamic'

// GET — one settlement's lines, grouped by what each paid for.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  if ((await razorpayAccountFor()).kind === 'route') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const detail = await settlementDetail((await params).id)
  if (!detail) return NextResponse.json({ error: 'Settlement not found' }, { status: 404 })
  return NextResponse.json(detail)
}
