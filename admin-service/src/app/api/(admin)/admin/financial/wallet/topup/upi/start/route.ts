import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { handleUpiStart } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

// Wallet top-up by UPI: paid to the platform (its PhonePe, else its UPI ID), like the Razorpay top-up.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return handleUpiStart(request, { kind: 'admin', adminId: admin.adminId }, { returnPrefix: '/admin' })
}
