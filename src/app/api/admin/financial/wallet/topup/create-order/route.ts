import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCurrentTenant } from '@/lib/tenant-context'
import { getRazorpayInstance, isRazorpayEnabled } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

// A wallet top-up pays the platform for shared-Delhivery shipping cost, so it always runs on the
// platform Razorpay account (getRazorpayInstance / env keys) — never the tenant's own keys.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const tenant = getCurrentTenant()
  if (!tenant?.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  if (!(await isRazorpayEnabled())) {
    return NextResponse.json({ error: 'Online payments are not available' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const amountInr = Number(body?.amountInr)
  if (!(amountInr > 0)) return NextResponse.json({ error: 'amountInr must be positive' }, { status: 400 })

  const amountInPaise = Math.round(amountInr * 100)
  try {
    const razorpay = getRazorpayInstance()
    const receipt = `wtop-${tenant.tenantId.slice(0, 8)}-${Date.now().toString(36)}`.slice(0, 40)
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      notes: { purpose: 'wallet_topup', tenant_id: tenant.tenantId, tenant_slug: tenant.slug ?? '' },
    })
    return NextResponse.json({
      razorpayOrderId: order.id,
      amount: amountInPaise,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    })
  } catch (error: any) {
    const msg = error?.error?.description || error?.message || 'Failed to create top-up order'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
