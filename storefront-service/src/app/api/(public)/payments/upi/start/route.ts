import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { handleUpiStart } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isBusiness = user.isBusiness === true || request.headers.get('x-auth-portal') === 'business'
  return handleUpiStart(request, { kind: 'customer', userId: user.userId, isBusiness }, { returnPrefix: isBusiness ? '/business' : '' })
}
