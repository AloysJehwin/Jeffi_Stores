import { invoiceUrlForOrder } from '../../lib/customer-links'
import { isFulfilledStatus } from '../../lib/fulfilled-status'
import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryOne, queryMany, withTransaction } from '@jeffi/tenancy'
import { deductOrderStock, InsufficientStockError } from '../../lib/inventory-deduct'
import { getFeatureFlags } from '../../lib/site-controls'
import { sendInvoiceFinalizedEmail } from '../../lib/mail'
import { invoiceReply } from '../../lib/reply-context'
import { generateOrderInvoice, assignInvoiceNumber } from '../../lib/invoice'
import { announceLock, assertHolder, closeLock, draftLockResponse, epochFrom } from '../../lib/draft-locks'
import { assertCompleteLines, IncompleteLinesError } from '../../lib/invoice-line-items'


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
      `SELECT id, status, source, customer_name, customer_email, total_amount, order_number, draft_of_id FROM orders WHERE id = $1`,
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (order.draft_of_id)
      return NextResponse.json({ error: 'This is an amendment draft — publish the amendment instead' }, { status: 400 })
    const allowedStatuses = ['draft', 'confirmed', 'delivered', 'granted', 'processing']
    if (!allowedStatuses.includes(order.status)) {
      return NextResponse.json({ error: 'Invoice is already finalized' }, { status: 400 })
    }

    const isOnlineOrder = order.source === 'online' || order.source === 'business'
    // If already fulfilled (delivered/granted), keep status unchanged; otherwise move online/business→processing, offline→delivered
    const targetStatus = isFulfilledStatus(order.status) ? order.status : isOnlineOrder ? 'processing' : 'delivered'

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
      // A draft may have been saved with half-filled custom lines.
      assertCompleteLines(
        [...items]
          .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
          .map(i => ({ product_id: i.product_id, name: i.product_name, rate: i.unit_price }))
      )

      if (inventoryValidationEnabled && hasScope(admin.role, admin.scopes, 'inventory:read')) {
        // Store-product lines only (custom lines have no product_id). Online cart lines
        // without a buy_unit are per base piece, so no default-unit fallback for them.
        await deductOrderStock(
          id,
          {
            batchAssignments,
            serialAssignments,
            requireSerialAssignments: true,
            defaultUnitFallback: order.source !== 'online',
          },
          client
        )
      }

      // Assign the invoice number (GST-gated, idempotent) via the shared helper,
      // then move the order to its target status. Same effect as the previous
      // inline block; reused by the processing-transition path.
      const invoiceNumber = await assignInvoiceNumber(client, id)
      await client.query(
        `UPDATE orders SET status = $1, invoice_date = COALESCE(invoice_date, NOW()), updated_at = NOW() WHERE id = $2`,
        [targetStatus, id]
      )

      // A draft belongs to its lock holder; finalizing ends the lock.
      let lock = null
      if (order.status === 'draft') {
        lock = await assertHolder(client, admin, 'invoice', id, { epoch: epochFrom(request) })
        await closeLock(client, admin, 'invoice', id, 'finalized')
      }
      return { invoiceNumber, orderId: id, lock }
    })
    await announceLock(admin, 'invoice', id, result.lock)

    if (result.invoiceNumber) {
      if (order.customer_email) {
        try {
          await sendInvoiceFinalizedEmail(
            order.customer_email,
            order.customer_name,
            result.invoiceNumber,
            Number(order.total_amount),
            order.order_number,
            await invoiceUrlForOrder(id),
            await invoiceReply(id)
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
    const locked = draftLockResponse(err)
    if (locked) return locked
    if (err instanceof IncompleteLinesError) return NextResponse.json({ error: err.message }, { status: 400 })
    if (err instanceof InsufficientStockError)
      return NextResponse.json({ error: `Cannot finalize — ${err.message}`, code: err.code }, { status: 409 })
    console.error(`[admin/invoices/drafts/${(await params).id}/finalize] failed`, err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
