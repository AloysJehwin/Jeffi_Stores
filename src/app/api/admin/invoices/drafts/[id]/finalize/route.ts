import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { deductOrderStock } from '@/lib/orders/inventory-deduct'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { sendInvoiceFinalizedEmail, sendOrderStatusUpdate } from '@/lib/email'
import { generateOrderInvoice, assignInvoiceNumber } from '@/lib/documents/invoice'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    let batchAssignments: { order_item_id: string; batch_id: string; qty: number }[] = []
    let serialAssignments: { order_item_id: string; serial_number: string }[] = []
    try {
      const body = await request.json()
      if (Array.isArray(body?.batch_assignments)) batchAssignments = body.batch_assignments
      if (Array.isArray(body?.serial_assignments)) serialAssignments = body.serial_assignments
    } catch (_) {}

    const order = await queryOne<any>(
      `SELECT id, status, source, customer_name, customer_email, total_amount, order_number FROM orders WHERE id = $1`,
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    const allowedStatuses = ['draft', 'confirmed', 'delivered', 'processing']
    if (!allowedStatuses.includes(order.status)) {
      return NextResponse.json({ error: 'Invoice is already finalized' }, { status: 400 })
    }

    const isOnlineOrder = order.source === 'online' || order.source === 'business'
    // If already delivered, keep status unchanged; otherwise move online/business→processing, offline→delivered
    const targetStatus = order.status === 'delivered' ? 'delivered' : isOnlineOrder ? 'processing' : 'delivered'

    // Basic-plan tenants have no inventory module — the flag is locked off for them.
    // When off, skip stock deduction entirely (nothing to deduct), same as order-create.
    const { inventoryValidationEnabled } = await getFeatureFlags()

    const result = await withTransaction(async client => {
      await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [id])

      const itemsResult = await client.query(`SELECT * FROM order_items WHERE order_id = $1`, [id])
      const items = itemsResult.rows

      if (!items.length) {
        throw new Error('Cannot finalize an invoice with no items')
      }

      if (inventoryValidationEnabled && hasScope(admin.role, admin.scopes, 'inventory:read')) {
        await deductOrderStock(id, { batchAssignments, serialAssignments, requireSerialAssignments: true }, client)
      }

      // Assign the invoice number (GST-gated, idempotent) via the shared helper,
      // then move the order to its target status. Same effect as the previous
      // inline block; reused by the processing-transition path.
      const invoiceNumber = await assignInvoiceNumber(client, id)
      await client.query(
        `UPDATE orders SET status = $1, invoice_date = COALESCE(invoice_date, NOW()), updated_at = NOW() WHERE id = $2`,
        [targetStatus, id]
      )

      return { invoiceNumber, orderId: id }
    })

    if (result.invoiceNumber) {
      if (isOnlineOrder && order.customer_email) {
        try {
          const pdfBuffer = await generateOrderInvoice(id)
          await sendOrderStatusUpdate(
            order.customer_email,
            order.customer_name,
            order.order_number,
            id,
            'processing',
            undefined,
            pdfBuffer
          )
        } catch (_) {}
      } else if (!isOnlineOrder && order.customer_email) {
        try {
          await sendInvoiceFinalizedEmail(
            order.customer_email,
            order.customer_name,
            result.invoiceNumber,
            Number(order.total_amount),
            order.order_number
          )
        } catch (_) {}
      }
    }

    return NextResponse.json({
      success: true,
      invoiceNumber: result.invoiceNumber,
      invoiceUrl: result.invoiceNumber ? `/api/orders/${result.orderId}/invoice` : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
