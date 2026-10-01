import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'
import { sendPurchaseOrderEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const po = await queryOne<any>(
      `SELECT po.*, s.name AS supplier_name, s.contact_name, s.email AS supplier_email
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1`,
      [id]
    )
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 })
    if (!po.supplier_email)
      return NextResponse.json({ error: 'No email address on file for this supplier' }, { status: 400 })

    const poItems = await queryMany<any>(
      `SELECT poi.quantity, poi.unit_cost,
              COALESCE(poi.product_name, p.name) AS product_name,
              pv.variant_name
       FROM purchase_order_items poi
       LEFT JOIN products p ON p.id = poi.product_id
       LEFT JOIN product_variants pv ON pv.id = poi.variant_id
       WHERE poi.po_id = $1`,
      [id]
    )

    const viewUrl = `https://purchaseorder.jeffistores.in/${po.view_token}`

    await sendPurchaseOrderEmail(
      po.supplier_email,
      po.contact_name || '',
      po.supplier_name,
      po.po_number,
      parseFloat(po.total_amount),
      (poItems || []).map((it: any) => ({
        product_name: it.product_name,
        variant_name: it.variant_name,
        quantity: parseFloat(it.quantity),
        unit_cost: parseFloat(it.unit_cost),
      })),
      viewUrl
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
