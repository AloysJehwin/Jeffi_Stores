import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { handleUpiAdminDecide } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

// Approve or reject a manual UPI payment against the UTR the customer entered.
export async function POST(request: NextRequest, { params }: { params: Promise<{ intentId: string }> }) {
  const admin = await requireAdminScope(request, 'financial:write')
  if (admin instanceof NextResponse) return admin
  return handleUpiAdminDecide(request, (await params).intentId, admin)
}
