import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getTenant } from '@/lib/tenant-registry'
import { reconcileCapturedTransactions } from '@/lib/payments/razorpay-route'

export const dynamic = 'force-dynamic'

// Platform admin: settle this tenant's captured prepaid rows whose Route transfer has already
// processed at Razorpay (the transfer.processed race). Reads live transfer status; idempotent.
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const result = await reconcileCapturedTransactions({ tenantId, olderThanMinutes: 0, limit: 500 })
  return NextResponse.json(result)
}
