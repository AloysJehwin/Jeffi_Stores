import { NextRequest } from 'next/server'
import { proxyAdminDocs } from '@/lib/documents/proxy'

export const dynamic = 'force-dynamic'

// UPI QR conversions go through POST /api/admin/payments/qr-intents (the QR first, the invoice once paid).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyAdminDocs(request, `/admin/quotations/${id}/convert-to-invoice`, 'quotations:write')
}
