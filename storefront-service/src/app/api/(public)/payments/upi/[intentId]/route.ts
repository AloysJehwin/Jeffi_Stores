import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { handleUpiStatus } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ intentId: string }> }) {
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return handleUpiStatus((await params).intentId, { kind: 'customer', userId: user.userId })
}
