import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { rejectAdjustment } from '@/lib/orders/adjustment-decision'

export const dynamic = 'force-dynamic'

// POST — the customer declines the proposed changes (nothing has been paid or refunded yet).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; adjId: string }> }) {
  const { id: orderId, adjId } = await params
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await rejectAdjustment(adjId, orderId, user.userId))) return NextResponse.json({ error: 'This change can no longer be declined.' }, { status: 409 })
  return NextResponse.json({ success: true })
}
