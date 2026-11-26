import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { cancelQrIntent, getQrIntent, qrIntentView, QR_INTENT_SCOPE } from '@/lib/payments/qr-intents'

export const dynamic = 'force-dynamic'

/** Closes the QR and cancels the intent. 409 (with the status) when it was paid first: keep polling it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const intent = await getQrIntent(id)
    if (!intent) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (!hasScope(admin.role, admin.scopes, QR_INTENT_SCOPE[intent.kind]))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const view = await qrIntentView((await cancelQrIntent(id)) ?? intent)
    if (view.status === 'cancelled' || view.status === 'expired') return NextResponse.json(view)
    return NextResponse.json({ ...view, error: view.error ?? `This payment is already ${view.status}` }, { status: 409 })
  } catch (err: any) {
    console.error('[admin/payments/qr-intents/[id]/cancel] failed', err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
