import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { InsufficientStockError } from '@/lib/orders/inventory-deduct'
import { assignmentsOf, createOfflineInvoice, createOrderSchema, OfflineInvoiceError } from '@/lib/orders/offline-invoice'
import { parseBody } from '@/lib/shared/validate'
import { actorOf } from '@/lib/admin/draft-locks'
import { QR_FIRST_MESSAGE } from '@/lib/payments/qr-intents/types'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const parsed = parseBody(createOrderSchema, body, 'POST /api/admin/orders/create')
    if (!parsed.ok) return parsed.response
    // The QR comes first; the invoice is made once Razorpay confirms the payment.
    if (parsed.data.paymentMode === 'upi_qr') return NextResponse.json({ error: QR_FIRST_MESSAGE }, { status: 400 })

    const result = await createOfflineInvoice(parsed.data, assignmentsOf(body), { actor: actorOf(admin) })

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      invoiceNumber: result.invoiceNumber,
      invoiceUrl: result.invoiceNumber ? `/api/orders/${result.orderId}/invoice` : null,
      savedAsDraft: result.saveAsDraft,
      insufficientItems: result.insufficientItems,
      insufficientDetails: result.shortfalls,
    })
  } catch (err: any) {
    if (err instanceof OfflineInvoiceError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof InsufficientStockError)
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 })
    console.error('[admin/orders/create] failed', err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
