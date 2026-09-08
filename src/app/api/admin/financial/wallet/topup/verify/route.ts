import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { resolveTenant } from '@/lib/tenant-context'
import { getRazorpayInstance } from '@/lib/razorpay'
import { rechargeWallet } from '@/lib/wallet'
import { controlPlanePool } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

// Verifies a wallet top-up collected on the PLATFORM Razorpay account, then credits the tenant
// wallet. HMAC uses the platform key_secret (env). The credited amount is the authoritative amount
// on the Razorpay order, not a client-supplied value. Idempotent per razorpay_payment_id.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // ALS tenant context is empty at the start of an API handler; resolveTenant() bridges from
  // the x-tenant-id/slug header the middleware sets (matches the sibling topup GET).
  const tenant = await resolveTenant()
  if (!tenant?.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const razorpay_order_id = String(body?.razorpay_order_id || '')
  const razorpay_payment_id = String(body?.razorpay_payment_id || '')
  const razorpay_signature = String(body?.razorpay_signature || '')
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ error: 'Missing payment fields' }, { status: 400 })
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keySecret) return NextResponse.json({ error: 'Payments not configured' }, { status: 400 })

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex')
  if (expected !== razorpay_signature) {
    return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
  }

  const noteRef = `Razorpay top-up ${razorpay_payment_id}`
  const dup = await controlPlanePool().query(
    `SELECT 1 FROM wallet_ledger WHERE tenant_id = $1 AND entry_type = 'recharge' AND note = $2 LIMIT 1`,
    [tenant.tenantId, noteRef],
  )
  if (dup.rowCount && dup.rowCount > 0) {
    return NextResponse.json({ success: true, alreadyCredited: true })
  }

  let amountInr: number
  try {
    const order = await getRazorpayInstance().orders.fetch(razorpay_order_id)
    if (order?.notes?.purpose !== 'wallet_topup' || order?.notes?.tenant_id !== tenant.tenantId) {
      return NextResponse.json({ error: 'Order does not belong to this wallet' }, { status: 400 })
    }
    amountInr = Number(order.amount_paid || order.amount) / 100
  } catch (error: any) {
    const msg = error?.error?.description || error?.message || 'Could not verify top-up order'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
  if (!(amountInr > 0)) return NextResponse.json({ error: 'Top-up amount must be positive' }, { status: 400 })

  const result = await rechargeWallet({ tenantId: tenant.tenantId, amountInr, note: noteRef })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ success: true, balance: result.balance })
}
