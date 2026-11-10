import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { handleUpiAdminList } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

// UPI intents for the confirmations page: ?status=awaiting_confirmation&limit=&offset=
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  return handleUpiAdminList(request)
}
