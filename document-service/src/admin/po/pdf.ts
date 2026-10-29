import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryOne } from '@jeffi/tenancy'
import { loadPurchaseOrder, purchaseOrderPdf } from '../../tenant/loaders'

// The supplier's PO as a PDF, for staff (the public page needs its view token).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    const row = await queryOne<{ view_token: string | null }>(`SELECT view_token FROM purchase_orders WHERE id = $1`, [id])
    const data = row?.view_token ? await loadPurchaseOrder(row.view_token) : null
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { buffer, filename } = await purchaseOrderPdf(data)
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Length': String(buffer.length) },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
