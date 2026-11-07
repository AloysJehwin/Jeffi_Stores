import type { PoolClient } from 'pg'
import { withTransaction } from '@/lib/shared/db'
import { issueOrderInvoice } from '@/lib/orders/issue-invoice'
import type { NormalizedOrder } from './types'

// AJIO's B2B purchase order: AJIO buys the item from the store when it is packed, so the store
// invoices AJIO (its GSTIN) under its own numbering. Issued at most once per order; a PO that
// arrives after a later status (a stale event the upsert ignored) is still recorded here.

export interface PoInvoiceOutcome {
  invoiceNumber: string
  issued: boolean
}

type Po = NonNullable<NormalizedOrder['po']>

async function recordInTx(db: PoolClient, channel: string, externalOrderId: string, po: Po): Promise<PoInvoiceOutcome | null> {
  const row = (
    await db.query<{ id: string; order_id: string | null; status: string }>(
      `SELECT id, order_id, status FROM marketplace_orders WHERE channel = $1 AND external_order_id = $2 FOR UPDATE`,
      [channel, externalOrderId]
    )
  ).rows[0]
  if (!row?.order_id) return null
  await db.query(
    `UPDATE marketplace_orders SET po_number = COALESCE(po_number, $2), po_date = COALESCE(po_date, $3::timestamptz),
       po_amount = COALESCE(po_amount, $4), updated_at = now() WHERE id = $1`,
    [row.id, po.number, po.date ?? null, po.amount ?? null]
  )
  if (row.status === 'cancelled' || row.status === 'rejected') return null
  const locked = (await db.query<{ invoice_number: string | null }>(`SELECT invoice_number FROM orders WHERE id = $1 FOR UPDATE`, [row.order_id])).rows[0]
  if (locked?.invoice_number) return { invoiceNumber: locked.invoice_number, issued: false }
  await db.query(
    `UPDATE orders SET buyer_gstin = COALESCE($2, buyer_gstin), customer_name = COALESCE($3, customer_name), updated_at = now() WHERE id = $1`,
    [row.order_id, po.buyerGstin ?? null, po.buyerName ?? null]
  )
  const inv = await issueOrderInvoice(db, row.order_id)
  return { invoiceNumber: inv.invoiceNumber, issued: true }
}

/** Stores the PO on the marketplace order and issues our invoice to AJIO, once. */
export async function recordPurchaseOrder(order: Pick<NormalizedOrder, 'channel' | 'externalOrderId' | 'po'>): Promise<PoInvoiceOutcome | null> {
  if (order.channel !== 'ajio' || !order.po?.number) return null
  const po = order.po
  return withTransaction(db => recordInTx(db, order.channel, order.externalOrderId.trim(), po))
}
