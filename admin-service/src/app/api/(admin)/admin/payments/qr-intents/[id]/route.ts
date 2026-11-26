import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getQrIntent, pollQrIntent, qrIntentView, QR_INTENT_SCOPE } from '@/lib/payments/qr-intents'

export const dynamic = 'force-dynamic'

/** The QR dialog's poll: { status, resultRef?, resultUrl?, invoiceUrl?, invoiceNumber?, error?, amount, expiresAt }. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const intent = await getQrIntent(id)
    if (!intent) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (!hasScope(admin.role, admin.scopes, QR_INTENT_SCOPE[intent.kind]))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const row = (await pollQrIntent(id)) ?? intent
    return NextResponse.json(await qrIntentView(row))
  } catch (err: any) {
    console.error('[admin/payments/qr-intents/[id]] failed', err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
