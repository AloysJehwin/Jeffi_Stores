import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { withTransaction } from '@/lib/db'
import { isInterState, calculateGST, getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence, round2 } from '@/lib/gst'
import { lineItemFromMrpIncl } from '@/lib/pricing'
import { logStockMovement } from '@/lib/inventory'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { z } from 'zod'
import { parseBody, zUuid, zNonEmpty } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const orderItemSchema = z.object({
  product_id: zUuid.nullish(),
  variant_id: zUuid.nullish(),
  sub_variant_id: zUuid.nullish(),
  product_name: z.string().default(''),
  product_sku: z.string().nullish(),
  variant_name: z.string().nullish(),
  hsn_code: z.string().nullish(),
  gst_rate: z.coerce.number().min(0).default(18),
  unit_price: z.coerce.number().min(0),
  quantity: z.coerce.number().positive(),
  buy_unit: z.string().nullish(),
  buy_mode: z.string().nullish(),
  temp_id: z.string().nullish(),
})

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
  items: z.array(orderItemSchema).min(1),
  paymentMode: z.string().nullish(),
})

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const batchAssignments: { order_item_id: string; batch_id: string }[] = Array.isArray(body?.batch_assignments) ? body.batch_assignments : []

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

    const sellerStateCode = process.env.BUSINESS_STATE_CODE || '33'
    const orderIsIgst = buyerGstin ? isInterState(state || '', sellerStateCode) : false

    let subtotal = 0
    let totalTaxable = 0
    let totalCgst = 0
    let totalSgst = 0
    let totalIgst = 0

    const processedItems = items.map((item: any) => {
      const unitPrice = parseFloat(item.unit_price)
      const qty = parseFloat(item.quantity)
      const discPct = parseFloat(item.discount_pct || '0') || 0
      const gstRate = parseFloat(item.gst_rate || '18')
      const lineTotal = round2(lineItemFromMrpIncl(qty, unitPrice, discPct, gstRate))
      const gst = calculateGST(lineTotal, gstRate, orderIsIgst)

      subtotal += lineTotal
      totalTaxable += gst.taxableAmount
      totalCgst += gst.cgst
      totalSgst += gst.sgst
      totalIgst += gst.igst

      return {
        product_id: item.product_id || null,
        product_name: item.product_name,
        product_sku: item.product_sku || '',
        variant_id: item.variant_id || null,
        sub_variant_id: item.sub_variant_id || null,
        variant_name: item.variant_name || null,
        hsn_code: item.hsn_code || null,
        gst_rate: gstRate,
        quantity: qty,
        buy_unit: item.buy_unit || null,
        buy_mode: item.buy_mode || 'unit',
        unit_price: unitPrice,
        total_price: lineTotal,
        taxable_amount: round2(gst.taxableAmount),
        cgst_amount: round2(gst.cgst),
        sgst_amount: round2(gst.sgst),
        igst_amount: round2(gst.igst),
        tax_amount: round2(gst.cgst + gst.sgst + gst.igst),
        temp_id: item.temp_id || null,
      }
    })

    const taxAmount = round2(totalCgst + totalSgst + totalIgst)
    const totalAmount = round2(subtotal)

    const result = await withTransaction(async (client) => {
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

      const insufficientItems: string[] = []
      for (const item of processedItems) {
        if (!item.product_id) continue
        // Resolve unit factor to get base-unit quantity for stock checks
        const unitRow = await client.query<{ factor: string; dimension: string }>(
          `SELECT COALESCE(puv.factor, pup.factor) AS factor,
                  COALESCE(puv.dimension, pup.dimension) AS dimension
           FROM (SELECT 1) x
           LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3
           LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL`,
          [item.buy_unit, item.product_id, item.variant_id || null]
        )
        const u = unitRow.rows[0]
        const baseQty = (u?.dimension === 'count' && u?.factor)
          ? item.quantity * parseFloat(u.factor)
          : item.quantity

        const assignedBatchId = batchAssignments.find(a => a.order_item_id === item.temp_id)?.batch_id ?? null
        let batchQty = 0
        if (assignedBatchId) {
          const br = await client.query<{ quantity_remaining: string }>(
            `SELECT quantity_remaining FROM product_batches WHERE id = $1`, [assignedBatchId]
          )
          batchQty = parseFloat(br.rows[0]?.quantity_remaining ?? '0') || 0
        }

        if (item.sub_variant_id) {
          const inv = await client.query<{ inventory_quantity: string }>(
            `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
            [item.sub_variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
          if (stock + batchQty < baseQty) {
            insufficientItems.push(
              `${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''} (available: ${stock + batchQty}, required: ${baseQty})`
            )
          }
        } else if (item.variant_id) {
          const inv = await client.query<{ inventory_quantity: string }>(
            `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
            [item.variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
          if (stock + batchQty < baseQty) {
            insufficientItems.push(
              `${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''} (available: ${stock + batchQty}, required: ${baseQty})`
            )
          }
        } else {
          const inv = await client.query<{ inventory_quantity: string }>(
            `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
            [item.product_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
          if (stock + batchQty < baseQty) {
            insufficientItems.push(`${item.product_name} (available: ${stock + batchQty}, required: ${baseQty})`)
          }
        }
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
          orderNumber, customerName, customerPhone || '', customerEmail || '',
          subtotal, taxAmount, totalAmount,
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

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name,
            hsn_code, gst_rate, quantity, buy_unit, buy_mode, unit_price, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$18,$19)`,
          [
            orderId, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.sub_variant_id, item.variant_name,
            item.hsn_code, item.gst_rate, item.quantity, item.buy_unit, item.buy_mode,
            item.unit_price,
            item.tax_amount, item.total_price, item.taxable_amount,
            item.cgst_amount, item.sgst_amount, item.igst_amount,
          ]
        )
      }

      let invoiceNumber: string | null = null

      if (!saveAsDraft) {
        for (const item of processedItems) {
          if (!item.product_id) continue
          // Resolve unit factor for base-unit stock deduction
          const unitRow = await client.query<{ factor: string; dimension: string }>(
            `SELECT COALESCE(puv.factor, pup.factor) AS factor,
                    COALESCE(puv.dimension, pup.dimension) AS dimension
             FROM (SELECT 1) x
             LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3
             LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL`,
            [item.buy_unit, item.product_id, item.variant_id || null]
          )
          const u = unitRow.rows[0]
          const qty = (u?.dimension === 'count' && u?.factor)
            ? item.quantity * parseFloat(u.factor)
            : item.quantity

          let stockBefore = 0
          if (item.sub_variant_id) {
            const row = await client.query<{ inventory_quantity: string }>(
              `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
              [item.sub_variant_id]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
              [qty, item.sub_variant_id]
            )
          } else if (item.variant_id) {
            const row = await client.query<{ inventory_quantity: string }>(
              `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
              [item.variant_id]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              `UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
              [qty, item.variant_id]
            )
          } else {
            const row = await client.query<{ inventory_quantity: string }>(
              `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
              [item.product_id]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              `UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
              [qty, item.product_id]
            )
          }
          await logStockMovement(client, {
            productId: item.product_id,
            variantId: item.variant_id || null,
            subVariantId: item.sub_variant_id || null,
            transactionType: 'sale',
            quantityChange: -qty,
            referenceType: 'order',
            referenceId: orderId,
            currentStock: stockBefore,
          })
        }

        const isGSTEnabled = process.env.ENABLE_GST === 'true'
        if (isGSTEnabled) {
          const settingsResult = await client.query("SELECT value FROM site_settings WHERE key = 'invoice_prefix'")
          const prefix = settingsResult.rows[0]?.value || 'JS'
          const fy = getFinancialYear(new Date())
          const seq = await getNextInvoiceSequence(client, fy)
          invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
          const invoiceDate = new Date().toISOString()
          await client.query(
            `UPDATE orders SET invoice_number = $1, invoice_date = $2 WHERE id = $3`,
            [invoiceNumber, invoiceDate, orderId]
          )
          await client.query(
            `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`,
            [orderId, invoiceNumber, fy, seq]
          )
        }
      }

      return { orderId, orderNumber: finalOrderNumber, invoiceNumber, saveAsDraft, insufficientItems }
    })

    if (!result.saveAsDraft && result.invoiceNumber && customerEmail) {
      try {
        await sendInvoiceFinalizedEmail(customerEmail, customerName, result.invoiceNumber, round2(totalAmount), result.orderNumber)
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
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
