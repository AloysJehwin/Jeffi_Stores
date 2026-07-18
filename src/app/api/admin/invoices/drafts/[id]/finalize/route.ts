import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence } from '@/lib/gst'
import { deductOrderStock } from '@/lib/inventory-deduct'
import { sendInvoiceFinalizedEmail, sendOrderStatusUpdate } from '@/lib/email'
import { generateOrderInvoice } from '@/lib/invoice'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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
    const targetStatus = order.status === 'delivered' ? 'delivered' : (isOnlineOrder ? 'processing' : 'delivered')

    const result = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [id])

      const itemsResult = await client.query(
        `SELECT * FROM order_items WHERE order_id = $1`,
        [id]
      )
      const items = itemsResult.rows

      if (!items.length) {
        throw new Error('Cannot finalize an invoice with no items')
      }

      // Deduct inventory (plain/perishable/serialized) via the shared helper.
      // requireSerialAssignments preserves the "serials required for serialized
      // products" contract; batches auto-pick FEFO when none are supplied.
      await deductOrderStock(id, { batchAssignments, serialAssignments, requireSerialAssignments: true }, client)

      const isGSTEnabled = process.env.ENABLE_GST === 'true'
      let invoiceNumber: string | null = null

      if (isGSTEnabled) {
        const settingsResult = await client.query(`SELECT value FROM site_settings WHERE key = 'invoice_prefix'`)
        const prefix = settingsResult.rows[0]?.value || 'JS'
        const fy = getFinancialYear(new Date())
        const seq = await getNextInvoiceSequence(client, fy)
        invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
        const invoiceDate = new Date().toISOString()

        await client.query(
          `UPDATE orders SET invoice_number = $1, invoice_date = $2, status = $3, updated_at = NOW() WHERE id = $4`,
          [invoiceNumber, invoiceDate, targetStatus, id]
        )

        if (isOnlineOrder) {
          // Update the existing draft invoice row rather than inserting a new one
          await client.query(
            `UPDATE invoices SET invoice_number = $1, financial_year = $2, sequence_number = $3, status = 'finalized', updated_at = NOW()
             WHERE order_id = $4 AND status = 'draft'`,
            [invoiceNumber, fy, seq, id]
          )
        } else {
          await client.query(
            `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`,
            [id, invoiceNumber, fy, seq]
          )
        }
      } else {
        await client.query(
          `UPDATE orders SET status = $1, invoice_date = NOW(), updated_at = NOW() WHERE id = $2`,
          [targetStatus, id]
        )
      }

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
            pdfBuffer,
          )
        } catch (_) {}
      } else if (!isOnlineOrder && order.customer_email) {
        try {
          await sendInvoiceFinalizedEmail(order.customer_email, order.customer_name, result.invoiceNumber, Number(order.total_amount), order.order_number)
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
