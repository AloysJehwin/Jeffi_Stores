import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { handleUpiCancel } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ intentId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return handleUpiCancel((await params).intentId, { kind: 'admin', adminId: admin.adminId })
}
