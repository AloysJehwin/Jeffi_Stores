import { invoiceUrlForOrder } from '@/lib/shared/customer-links'
import { NextRequest, NextResponse } from 'next/server'
import { productLabel } from '@/lib/catalog/product-label'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getFeatureFlags, getBusinessValues } from '@/lib/catalog/site-controls'
import { findDigitalProductIds } from '@/lib/catalog/digital-guard'
import { withTransaction } from '@/lib/shared/db'
import {
  isInterState,
  getFinancialYear,
  generateInvoiceNumber,
  getNextInvoiceSequence,
  round2,
} from '@/lib/catalog/gst'
import {
  deductOrderStock,
  checkLineStock,
  resolveLineUnit,
  InsufficientStockError,
} from '@/lib/orders/inventory-deduct'
import {
  invoiceLineSchema,
  priceInvoiceLines,
  formatShortfall,
  type Shortfall,
} from '@/lib/documents/invoice-line-items'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const createOrderSchema = z.object({
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

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const batchAssignments: { order_item_id: string; batch_id: string; qty: number }[] = Array.isArray(
      body?.batch_assignments
    )
      ? body.batch_assignments
      : []
    const serialAssignments: { order_item_id: string; serial_number: string }[] = Array.isArray(
      body?.serial_assignments
    )
      ? body.serial_assignments
      : []

    const parsed = parseBody(createOrderSchema, body, 'POST /api/admin/orders/create')
    if (!parsed.ok) return parsed.response

    const {
      customerName,
      customerPhone,
      customerEmail,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      buyerGstin,
      paymentMode,
      items,
      notes,
    } = parsed.data

    const digitalIds = await findDigitalProductIds(items.map(i => i.product_id).filter((v): v is string => !!v))
    if (digitalIds.length)
      return NextResponse.json({ error: 'Digital products cannot be sold through this channel' }, { status: 400 })

    const sellerStateCode = (await getBusinessValues()).businessStateCode
    const orderIsIgst = buyerGstin ? isInterState(state || '', sellerStateCode) : false
    const { gstEnabled, inventoryValidationEnabled } = await getFeatureFlags()

    const priced = priceInvoiceLines(items, { gstEnabled, orderIsIgst })
    const processedItems = priced.lines
    const { subtotal, taxAmount, totalAmount, totalTaxable, totalCgst, totalSgst, totalIgst } = priced

    const result = await withTransaction(async client => {
      const addrResult = await client.query(
        `INSERT INTO addresses (full_name, address_line1, address_line2, city, state, postal_code, phone, address_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'shipping')
         RETURNING id`,
        [
          customerName,
          addressLine1 || '',
          addressLine2 || null,
          city || '',
          state || '',
          postalCode || '',
          customerPhone || '',
        ]
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
            const br = await client.query<{ quantity_remaining: string }>(
              `SELECT quantity_remaining FROM product_batches WHERE id = $1`,
              [a.batch_id]
            )
            const avail = parseFloat(br.rows[0]?.quantity_remaining ?? '0') || 0
            if (avail < a.qty) {
              batchShortfall = `batch available: ${avail} pcs, taking: ${a.qty} pcs`
              break
            }
          }
          if (batchShortfall || totalBatchQty < baseQty) {
            insufficientItems.push(
              `${productLabel(item)} (${batchShortfall || `batch total: ${totalBatchQty} pcs, required: ${baseQty} pcs`})`
            )
          }
        }
        insufficientItems.push(...shortfalls.map(formatShortfall))
      }

      const saveAsDraft = insufficientItems.length > 0

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
        {
          const settingsResult = await client.query("SELECT value FROM site_settings WHERE key = 'invoice_prefix'")
          const prefix = settingsResult.rows[0]?.value || 'JS'
          const fy = getFinancialYear(new Date())
          const seq = await getNextInvoiceSequence(client, fy)
          invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
          const invoiceDate = new Date().toISOString()
          await client.query(`UPDATE orders SET invoice_number = $1, invoice_date = $2 WHERE id = $3`, [
            invoiceNumber,
            invoiceDate,
            orderId,
          ])
          await client.query(
            `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`,
            [orderId, invoiceNumber, fy, seq]
          )
        }
      }

      return { orderId, orderNumber: finalOrderNumber, invoiceNumber, saveAsDraft, insufficientItems, shortfalls }
    })

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
    if (err instanceof InsufficientStockError)
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 })
    console.error('[admin/orders/create] failed', err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
