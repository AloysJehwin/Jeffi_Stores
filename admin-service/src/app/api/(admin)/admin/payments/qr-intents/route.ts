import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { createQrIntent, isQrIntentKind, QR_INTENT_KINDS, QR_INTENT_SCOPE, QrIntentError } from '@/lib/payments/qr-intents'

export const dynamic = 'force-dynamic'

/**
 * UPI QR first: { kind, payload } where payload is the body the create call takes. Validated by a dry run of that
 * call (stock included, per its flag); nothing is created until Razorpay confirms the payment.
 * Returns { intentId, qrImageUrl, amount (rupees), expiresAt }.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => null)
    const kind = body?.kind
    if (!isQrIntentKind(kind)) return NextResponse.json({ error: `kind must be one of ${QR_INTENT_KINDS.join(', ')}` }, { status: 400 })
    if (!hasScope(admin.role, admin.scopes, QR_INTENT_SCOPE[kind]))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const out = await createQrIntent({ kind, payload: body.payload, actor: { adminId: admin.adminId, role: admin.role, scopes: admin.scopes } })
    return NextResponse.json(out)
  } catch (err: any) {
    if (err instanceof QrIntentError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status })
    console.error('[admin/payments/qr-intents] failed', err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
