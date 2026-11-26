import { invoiceUrlForOrder } from '@/lib/shared/customer-links'
import { productLabel } from '@/lib/catalog/product-label'
import { getFeatureFlags, getBusinessValues } from '@/lib/catalog/site-controls'
import { findDigitalProductIds } from '@/lib/catalog/digital-guard'
import { withTransaction } from '@/lib/shared/db'
import { isInterState, round2 } from '@/lib/catalog/gst'
import { issueOrderInvoice } from '@/lib/orders/issue-invoice'
import { deductOrderStock, checkLineStock, resolveLineUnit, InsufficientStockError } from '@/lib/orders/inventory-deduct'
import { invoiceLineSchema, priceInvoiceLines, formatShortfall, type Shortfall } from '@/lib/documents/invoice-line-items'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { z } from 'zod'
import { zNonEmpty } from '@/lib/shared/validate'
import { lockNewDraft, type DraftActor } from '@/lib/admin/draft-locks'

/** POST /api/admin/orders/create: an offline invoice typed in the admin. */
export const createOrderSchema = z.object({
  customerName: zNonEmpty,
  customerPhone: z.string().nullish(),
  customerEmail: z.string().email().or(z.literal('')).nullish(),
  addressLine1: z.string().nullish(),
  addressLine2: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  postalCode: z.string().nullish(),
  buyerGstin: z.string().nullish(),
  notes: z.string().nullish(),
  items: z.array(invoiceLineSchema).min(1, 'Add at least one line item'),
  paymentMode: z.string().nullish(),
})

export type OfflineInvoiceData = z.infer<typeof createOrderSchema>
export type BatchAssignment = { order_item_id: string; batch_id: string; qty: number }
export type SerialAssignment = { order_item_id: string; serial_number: string }

/** A confirmed Razorpay UPI QR payment the invoice is created for (payment_intents). */
export interface QrPaymentRecord {
  razorpayPaymentId: string
  razorpayQrId: string | null
  amountPaise: number
  intentId: string
}

export class OfflineInvoiceError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
    this.name = 'OfflineInvoiceError'
  }
}

export interface OfflineInvoiceResult {
  orderId: string
  orderNumber: string
  invoiceNumber: string | null
  saveAsDraft: boolean
  insufficientItems: string[]
  shortfalls: Shortfall[]
  totalAmount: number
}

class DryRun extends Error {
  constructor(readonly result: OfflineInvoiceResult) {
    super('dry run')
  }
}

/** Raw body arrays, as the route takes them (anything else is no assignments). */
export function assignmentsOf(body: any): { batchAssignments: BatchAssignment[]; serialAssignments: SerialAssignment[] } {
  return {
    batchAssignments: Array.isArray(body?.batch_assignments) ? body.batch_assignments : [],
    serialAssignments: Array.isArray(body?.serial_assignments) ? body.serial_assignments : [],
  }
}

/**
 * Creates an offline invoice: order + lines, stock check and deduction (per the inventory flag) and its number,
 * then the draft lock or the customer email. Short on stock saves a draft, unless it is paid by QR (then it throws).
 * `dryRun` runs every check and write and rolls them back; `qrPayment` records the payment in the same transaction.
 */
export async function createOfflineInvoice(
  data: OfflineInvoiceData,
  assignments: { batchAssignments: BatchAssignment[]; serialAssignments: SerialAssignment[] },
  opts: { actor?: DraftActor; dryRun?: boolean; qrPayment?: QrPaymentRecord } = {}
): Promise<OfflineInvoiceResult> {
  const { batchAssignments, serialAssignments } = assignments
  const { customerName, customerPhone, customerEmail, addressLine1, addressLine2, city, state, postalCode, buyerGstin, paymentMode, items, notes } =
    data
  const qr = opts.qrPayment

  const digitalIds = await findDigitalProductIds(items.map(i => i.product_id).filter((v): v is string => !!v))
  if (digitalIds.length) throw new OfflineInvoiceError('Digital products cannot be sold through this channel')

  const sellerStateCode = (await getBusinessValues()).businessStateCode
  const orderIsIgst = buyerGstin ? isInterState(state || '', sellerStateCode) : false
  const { gstEnabled, inventoryValidationEnabled } = await getFeatureFlags()

  const priced = priceInvoiceLines(items, { gstEnabled, orderIsIgst })
  const processedItems = priced.lines
  const { subtotal, taxAmount, totalAmount, totalTaxable, totalCgst, totalSgst, totalIgst } = priced
  if (qr && Math.round(totalAmount * 100) !== qr.amountPaise)
    throw new OfflineInvoiceError(`The invoice total is ₹${round2(totalAmount)} but ₹${qr.amountPaise / 100} was paid`, 409)

  let result: OfflineInvoiceResult
  try {
    result = await withTransaction(async client => {
      const addrResult = await client.query(
        `INSERT INTO addresses (full_name, address_line1, address_line2, city, state, postal_code, phone, address_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'shipping')
         RETURNING id`,
        [customerName, addressLine1 || '', addressLine2 || null, city || '', state || '', postalCode || '', customerPhone || '']
      )
      const addressId = addrResult.rows[0].id

      const ts = Date.now()
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
      const orderNumber = `OFF-${ts}-${rand}`

      // Flag ON ⇒ check store-product stock (custom lines never touch inventory).
      const insufficientItems: string[] = []
      const shortfalls: Shortfall[] = []
      if (inventoryValidationEnabled) {
        for (const item of processedItems) {
          if (!item.product_id) continue
          const itemBatches = batchAssignments.filter(a => a.order_item_id === item.temp_id)
          if (itemBatches.length === 0) {
            shortfalls.push(...(await checkLineStock(client, [item], { defaultUnitFallback: true })))
            continue
          }
          const { baseQty } = await resolveLineUnit(client, item as typeof item & { product_id: string }, {
            defaultUnitFallback: true,
          })
          const totalBatchQty = itemBatches.reduce((s, a) => s + (a.qty || 0), 0)
          let batchShortfall = ''
          for (const a of itemBatches) {
            const br = await client.query<{ quantity_remaining: string }>(`SELECT quantity_remaining FROM product_batches WHERE id = $1`, [a.batch_id])
            const avail = parseFloat(br.rows[0]?.quantity_remaining ?? '0') || 0
            if (avail < a.qty) {
              batchShortfall = `batch available: ${avail} pcs, taking: ${a.qty} pcs`
              break
            }
          }
          if (batchShortfall || totalBatchQty < baseQty) {
            insufficientItems.push(`${productLabel(item)} (${batchShortfall || `batch total: ${totalBatchQty} pcs, required: ${baseQty} pcs`})`)
          }
        }
        insufficientItems.push(...shortfalls.map(formatShortfall))
      }

      const saveAsDraft = insufficientItems.length > 0
      // A paid QR invoice can't become a draft: the payment would hang on a document that isn't one.
      if (saveAsDraft && qr) throw new InsufficientStockError(`Not enough stock: ${insufficientItems.join('; ')}`, 'Not enough stock')

      const orderResult = await client.query(
        `INSERT INTO orders (
          order_number, customer_name, customer_phone, customer_email,
          subtotal, tax_amount, total_amount, discount_amount, shipping_amount,
          taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst,
          buyer_gstin, payment_status, status, source,
          shipping_address_id, billing_address_id,
          notes
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, 0, 0,
          $8, $9, $10, $11, $12,
          $13, $14, $15, 'offline',
          $16, $16,
          $17
        ) RETURNING id, order_number`,
        [
          orderNumber,
          customerName,
          customerPhone || '',
          customerEmail || '',
          subtotal,
          taxAmount,
          totalAmount,
          round2(totalTaxable),
          round2(totalCgst),
          round2(totalSgst),
          round2(totalIgst),
          orderIsIgst,
          buyerGstin || null,
          paymentMode === 'credit' ? 'unpaid' : 'paid',
          saveAsDraft ? 'draft' : 'delivered',
          addressId,
          notes || null,
        ]
      )
      const orderId = orderResult.rows[0].id
      const finalOrderNumber = orderResult.rows[0].order_number

      // Map each item's client-side temp_id to its persisted order_items row id
      // so batch/serial assignments (keyed by temp_id) resolve to real rows.
      const tempIdToItemId = new Map<string, string>()
      for (const item of processedItems) {
        const itemResult = await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name, sub_variant_name,
            hsn_code, gst_rate, quantity, buy_unit, buy_mode, sold_unit_factor, base_quantity,
            unit_price, mrp, discount_pct, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
          RETURNING id`,
          [
            orderId,
            item.product_id,
            item.product_name,
            item.product_sku,
            item.variant_id,
            item.sub_variant_id,
            item.variant_name,
            item.sub_variant_name ?? null,
            item.hsn_code,
            item.gst_rate,
            item.quantity,
            item.buy_unit,
            item.buy_mode,
            item.sold_unit_factor ?? null,
            item.base_quantity ?? null,
            item.unit_price,
            item.mrp,
            item.discount_pct,
            item.discount_amount,
            item.tax_amount,
            item.total_price,
            item.taxable_amount,
            item.cgst_amount,
            item.sgst_amount,
            item.igst_amount,
          ]
        )
        if (item.temp_id) tempIdToItemId.set(item.temp_id, itemResult.rows[0].id)
      }

      let invoiceNumber: string | null = null

      if (!saveAsDraft) {
        // Remap client-side temp_id → persisted order_items row id for the helper.
        const batchAssignmentsForDb = batchAssignments.map(a => ({
          ...a,
          order_item_id: tempIdToItemId.get(a.order_item_id) ?? a.order_item_id,
        }))
        const serialAssignmentsForDb = serialAssignments.map(a => ({
          ...a,
          order_item_id: tempIdToItemId.get(a.order_item_id) ?? a.order_item_id,
        }))

        // Flag ON ⇒ deduct store-product stock (plain / FEFO / serialized) and write
        // the 'sale' ledger — base-qty aware & idempotent. Flag OFF ⇒ no inventory.
        if (inventoryValidationEnabled) {
          await deductOrderStock(
            orderId,
            {
              batchAssignments: batchAssignmentsForDb,
              serialAssignments: serialAssignmentsForDb,
              requireSerialAssignments: true,
              defaultUnitFallback: true,
            },
            client
          )
        }

        // Assign an invoice number regardless of GST — GST-off just means a tax-free
        // invoice, but it must still be numbered so it appears on the invoice list.
        invoiceNumber = (await issueOrderInvoice(client, orderId)).invoiceNumber
      }

      if (qr) await recordQrPayment(client, orderId, qr)

      const out = { orderId, orderNumber: finalOrderNumber, invoiceNumber, saveAsDraft, insufficientItems, shortfalls, totalAmount }
      if (opts.dryRun) throw new DryRun(out)
      return out
    })
  } catch (e) {
    if (e instanceof DryRun) return e.result
    throw e
  }

  // Short on stock: the invoice is saved as a draft that belongs to this admin.
  if (result.saveAsDraft) await lockNewDraft(opts.actor, 'invoice', result.orderId)

  if (!result.saveAsDraft && result.invoiceNumber && customerEmail) {
    try {
      await sendInvoiceFinalizedEmail(
        customerEmail,
        customerName,
        result.invoiceNumber,
        round2(totalAmount),
        result.orderNumber,
        await invoiceUrlForOrder(result.orderId)
      )
    } catch (_) {}
  }
  return result
}

/** The paid-by-QR marks on an order, and its completed payment row (its transaction_id makes it once-only). */
export async function recordQrPayment(client: { query: (sql: string, params?: any[]) => Promise<any> }, orderId: string, qr: QrPaymentRecord) {
  await client.query(`UPDATE orders SET payment_status = 'paid', payment_mode = 'upi_qr', razorpay_qr_id = COALESCE($2, razorpay_qr_id), updated_at = NOW() WHERE id = $1`, [
    orderId,
    qr.razorpayQrId,
  ])
  await client.query(
    `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
     VALUES ($1, 'upi', 'razorpay_qr', $2, $3, 'completed', $4)`,
    [
      orderId,
      qr.razorpayPaymentId,
      qr.amountPaise / 100,
      JSON.stringify({ razorpay_payment_id: qr.razorpayPaymentId, razorpay_qr_id: qr.razorpayQrId, payment_intent_id: qr.intentId }),
    ]
  )
}
