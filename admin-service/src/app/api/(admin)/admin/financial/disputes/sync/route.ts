import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { syncDisputes } from '@/lib/payments/dispute-records'

export const dynamic = 'force-dynamic'

// POST — pull this store's disputes from Razorpay (ones the webhook missed or that predate it).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const tenant = await resolveRequestTenant()
    const { instance } = await getRazorpayInstanceFor(tenant?.tenantId)
    const out = await syncDisputes(instance)
    return NextResponse.json({ success: true, ...out })
  } catch (err: any) {
    return NextResponse.json({ error: err?.error?.description || err?.message || 'Could not reach Razorpay' }, { status: 502 })
  }
}
