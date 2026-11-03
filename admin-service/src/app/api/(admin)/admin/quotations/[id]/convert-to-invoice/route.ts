import { NextRequest, NextResponse } from 'next/server'
import { proxyAdminDocs } from '@/lib/documents/proxy'
import { createOrderUpiQr } from '@/lib/payments/upi-qr'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await proxyAdminDocs(request, `/admin/quotations/${id}/convert-to-invoice`, 'quotations:write')
  if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return res

  // A UPI-QR invoice: the QR is made here, on the store's Razorpay keys.
  const body = await res.json()
  const { qrRequest, ...rest } = body ?? {}
  if (qrRequest?.orderId) {
    try {
      const { qrImageUrl } = await createOrderUpiQr({
        order: { id: qrRequest.orderId, order_number: qrRequest.orderNumber },
        amountPaise: qrRequest.amountPaise,
        name: qrRequest.name,
        description: qrRequest.description,
      })
      rest.qrImageUrl = qrImageUrl
    } catch (e) {
      // Non-fatal: the admin can make the QR from the invoice page.
      console.error('[convert-to-invoice] UPI QR failed', e)
    }
  }
  return NextResponse.json(rest, { status: res.status })
}
