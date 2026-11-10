import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { handleUpiStatus } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ intentId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return handleUpiStatus((await params).intentId, { kind: 'admin', adminId: admin.adminId })
}
