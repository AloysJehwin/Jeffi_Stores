import { invoiceUrlForOrder } from '../../lib/customer-links'
import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryOne, withTransaction } from '@jeffi/tenancy'
import { isInterState, round2 } from '../../lib/gst'
import { logStockMovement } from '../../lib/inventory'
import { sendInvoiceFinalizedEmail } from '../../lib/mail'
import { syncPerishableStock, decrementNonPerishableShelfStock } from '../../lib/shelf'
import { deleteBatchIfEmpty, resolveLineUnit, readAvailableStock } from '../../lib/inventory-deduct'
import { getFeatureFlags, getBusinessValues } from '../../lib/site-controls'
import { parseBody } from '../../lib/validate'
import { productLabel } from '../../lib/product-label'
import type { SellingUnit } from '../../lib/selling-unit'
import {
  editInvoiceSchema,
  priceInvoiceLines,
  buildShortfall,
  formatShortfall,
  type Shortfall,
} from '../../lib/invoice-line-items'


export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(`SELECT id, source, invoice_number, status FROM orders WHERE id = $1`, [id])
    if (!order) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (order.source !== 'offline')
      return NextResponse.json({ error: 'Only offline invoices can be edited' }, { status: 400 })

    const parsed = parseBody(editInvoiceSchema, await request.json(), `PATCH /api/admin/invoices/${id}`)
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
      invoiceDate,
      notes,
      items,
    } = parsed.data

    const sellerStateCode = (await getBusinessValues()).businessStateCode
    const orderIsIgst = buyerGstin ? isInterState(state || '', sellerStateCode) : false

    // GST off ⇒ lines carry no tax and are charged at the ex-GST equivalent.
    const { gstEnabled, inventoryValidationEnabled } = await getFeatureFlags()
    const priced = priceInvoiceLines(items, { gstEnabled, orderIsIgst })
    const processedItems = priced.lines
    const { subtotal, taxAmount, totalAmount, totalTaxable, totalCgst, totalSgst, totalIgst } = priced
    // A draft never deducted stock — the finalize route does that in full.
    const wasDeducted = order.status !== 'draft'

    const isPaid = paymentMode !== 'credit'
    const effectiveDate = invoiceDate || new Date().toISOString().slice(0, 10)

    const result = await withTransaction(async client => {
      // Pieces already sold per grain (base qty, same resolution as deduction).
      const keyOf = (r: { product_id: string | null; variant_id?: string | null; sub_variant_id?: string | null }) =>
        `${r.product_id ?? ''}::${r.variant_id ?? ''}::${r.sub_variant_id ?? ''}`
      const prevBase = new Map<string, number>()
      if (inventoryValidationEnabled && wasDeducted) {
        const existingResult = await client.query(
          `SELECT product_id, variant_id, sub_variant_id, quantity, buy_unit, sold_unit, sold_unit_factor, base_quantity
             FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL`,
          [id]
        )
        for (const r of existingResult.rows) {
          const { baseQty } = await resolveLineUnit(client, r, { defaultUnitFallback: true })
          prevBase.set(keyOf(r), (prevBase.get(keyOf(r)) ?? 0) + baseQty)
        }
      }

      // Extra pieces each store-product line needs beyond what was already sold.
      const extras = new Map<(typeof processedItems)[number], { extraBase: number; unit: SellingUnit | null }>()
      const shortfalls: Shortfall[] = []
      for (const item of inventoryValidationEnabled ? processedItems : []) {
        if (!item.product_id) continue
        const line = { ...item, product_id: item.product_id }
        const { unit, baseQty, factor } = await resolveLineUnit(client, line, { defaultUnitFallback: true })
        const prev = prevBase.get(keyOf(item)) ?? 0
        prevBase.set(keyOf(item), Math.max(0, prev - baseQty))
        const extraBase = baseQty - prev
        if (extraBase <= 1e-6) continue
        extras.set(item, { extraBase, unit })
        const available = await readAvailableStock(client, line)
        const s = buildShortfall(productLabel(item), unit?.unit ?? item.buy_unit, factor, extraBase, available)
        if (s) shortfalls.push(s)
      }
      const insufficientItems = shortfalls.map(formatShortfall)

      const moveToDraft = insufficientItems.length > 0

      await client.query(
        `UPDATE orders SET
          customer_name = $1, customer_phone = $2, customer_email = $3,
          buyer_gstin = $4, is_igst = $5,
          subtotal = $6, tax_amount = $7, taxable_amount = $8,
          cgst_amount = $9, sgst_amount = $10, igst_amount = $11,
          total_amount = $12, payment_status = $13,
          invoice_date = $14, notes = $15,
          status = $16, invoice_number = $17,
          updated_at = NOW()
        WHERE id = $18`,
        [
          customerName,
          customerPhone || null,
          customerEmail || null,
          buyerGstin || null,
          orderIsIgst,
          subtotal,
          taxAmount,
          round2(totalTaxable),
          round2(totalCgst),
          round2(totalSgst),
          round2(totalIgst),
          totalAmount,
          isPaid ? 'paid' : 'unpaid',
          effectiveDate,
          notes || null,
          moveToDraft ? 'draft' : order.status,
          moveToDraft ? null : order.invoice_number,
          id,
        ]
      )

      if (moveToDraft && order.invoice_number) {
        await client.query(`DELETE FROM invoices WHERE order_id = $1`, [id])
      }

      if (addressLine1) {
        await client.query(
          `UPDATE addresses SET
            full_name = $1, address_line1 = $2, address_line2 = $3,
            city = $4, state = $5, postal_code = $6
          WHERE id = (SELECT shipping_address_id FROM orders WHERE id = $7)`,
          [customerName, addressLine1, addressLine2 || null, city || '', state || '', postalCode || '', id]
        )
      }

      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id])

      const savedItemIds: { product_id: string | null; variant_id: string | null; order_item_id: string }[] = []
      for (const item of processedItems) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name, sub_variant_name,
            hsn_code, gst_rate, quantity, buy_unit, sold_unit, sold_unit_factor, base_quantity,
            unit_price, mrp, discount_pct, discount_amount, total_price,
            taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
          [
            id,
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
            item.sold_unit,
            item.sold_unit_factor ?? null,
            item.base_quantity ?? null,
            item.unit_price,
            item.mrp,
            item.discount_pct,
            item.discount_amount,
            item.total_price,
            item.taxable_amount,
            item.cgst_amount,
            item.sgst_amount,
            item.igst_amount,
            item.tax_amount,
          ]
        )
        savedItemIds.push({
          product_id: item.product_id,
          variant_id: item.variant_id ?? null,
          order_item_id: inserted.rows[0].id,
        })
      }

      if (!moveToDraft && inventoryValidationEnabled && wasDeducted) {
        for (const item of processedItems) {
          const extra = extras.get(item)
          if (!item.product_id || !extra) continue
          const extraQty = extra.extraBase

          const prodRow = await client.query<{ perishable: boolean; serialized: boolean }>(
            `SELECT perishable, serialized FROM products WHERE id = $1`,
            [item.product_id]
          )
          const { perishable, serialized } = prodRow.rows[0] ?? { perishable: false, serialized: false }

          let stockBefore = 0

          if (perishable) {
            // Deduct from batches FIFO (earliest expiry first)
            const batches = await client.query<{
              id: string
              quantity_remaining: string
              lot_number: string | null
              expiry_date: string | null
            }>(
              `SELECT id, quantity_remaining, lot_number, expiry_date
               FROM product_batches
               WHERE product_id = $1
                 AND (variant_id = $2 OR ($2 IS NULL AND variant_id IS NULL))
                 AND (sub_variant_id = $3 OR ($3 IS NULL AND sub_variant_id IS NULL))
                 AND quantity_remaining > 0
               ORDER BY expiry_date ASC NULLS LAST, created_at ASC
               FOR UPDATE`,
              [item.product_id, item.variant_id || null, item.sub_variant_id || null]
            )
            let remaining = extraQty
            for (const batch of batches.rows) {
              if (remaining <= 0) break
              const avail = parseFloat(batch.quantity_remaining)
              const take = Math.min(avail, remaining)
              stockBefore = avail
              await client.query(
                `UPDATE product_batches SET quantity_remaining = quantity_remaining - $1, updated_at = NOW() WHERE id = $2`,
                [take, batch.id]
              )
              await logStockMovement(client, {
                productId: item.product_id!,
                variantId: item.variant_id || null,
                subVariantId: item.sub_variant_id || null,
                transactionType: 'sale',
                quantityChange: -take,
                referenceType: 'order',
                referenceId: id,
                currentStock: stockBefore,
                batchId: batch.id,
                lotNumber: batch.lot_number,
                expiryDate: batch.expiry_date,
              })
              remaining -= take
              // Drop the batch if this consumed it entirely.
              await deleteBatchIfEmpty(client, batch.id)
            }
            await syncPerishableStock(client, item.product_id!, item.variant_id || null, item.sub_variant_id || null)
          } else if (serialized) {
            // Serial count follows the qty_step rule (round(baseQty / qty_step)),
            // matching the shared deduction helper — not Math.ceil(extraQty).
            const stepVal = extra.unit?.qty_step || 1
            const serialCount = Math.round(extraQty / (stepVal > 0 ? stepVal : 1))
            // Take available serials FEFO, carrying each serial's own batch.
            const serials = await client.query<{ id: string; serial_number: string; batch_id: string | null }>(
              `SELECT ps.id, ps.serial_number, ps.batch_id FROM product_serials ps
               LEFT JOIN product_batches pb ON pb.id = ps.batch_id
               WHERE ps.product_id = $1
                 AND (ps.variant_id = $2 OR ($2 IS NULL AND ps.variant_id IS NULL))
                 AND ps.status = 'in_stock'
               ORDER BY pb.expiry_date ASC NULLS LAST, ps.created_at ASC
               LIMIT $3
               FOR UPDATE OF ps`,
              [item.product_id, item.variant_id || null, serialCount]
            )
            const invRow = await client.query<{ inventory_quantity: string }>(
              item.variant_id
                ? `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`
                : `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
              [item.variant_id || item.product_id]
            )
            stockBefore = parseFloat(invRow.rows[0]?.inventory_quantity ?? '0') || 0
            const touchedBatches = new Set<string>()
            for (const serial of serials.rows) {
              await client.query(
                `UPDATE product_serials SET status = 'sold', order_id = $1, order_item_id = $2, sold_at = NOW(), updated_at = NOW() WHERE id = $3`,
                [id, savedItemIds[processedItems.indexOf(item)]?.order_item_id ?? null, serial.id]
              )
              let lotNumber: string | null = null
              let expiryDate: string | null = null
              if (serial.batch_id) {
                const bu = await client.query<{ lot_number: string | null; expiry_date: string | null }>(
                  `UPDATE product_batches SET quantity_remaining = GREATEST(0, quantity_remaining - 1), updated_at = NOW() WHERE id = $1 RETURNING lot_number, expiry_date`,
                  [serial.batch_id]
                )
                lotNumber = bu.rows[0]?.lot_number ?? null
                expiryDate = bu.rows[0]?.expiry_date ?? null
                touchedBatches.add(serial.batch_id)
              }
              await logStockMovement(client, {
                productId: item.product_id!,
                variantId: item.variant_id || null,
                subVariantId: item.sub_variant_id || null,
                transactionType: 'sale',
                quantityChange: -1,
                referenceType: 'order',
                referenceId: id,
                currentStock: stockBefore,
                batchId: serial.batch_id,
                lotNumber,
                expiryDate,
                serialNumber: serial.serial_number,
              })
              stockBefore -= 1
            }
            for (const b of touchedBatches) await deleteBatchIfEmpty(client, b)
            await syncPerishableStock(client, item.product_id!, item.variant_id || null, item.sub_variant_id || null)
          } else {
            // Plain stock deduction
            if (item.sub_variant_id) {
              const row = await client.query<{ inventory_quantity: string }>(
                `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
                [item.sub_variant_id]
              )
              stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
              await client.query(
                `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
                [extraQty, item.sub_variant_id]
              )
            } else if (item.variant_id) {
              const row = await client.query<{ inventory_quantity: string }>(
                `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
                [item.variant_id]
              )
              stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
              await client.query(
                `UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
                [extraQty, item.variant_id]
              )
            } else {
              const row = await client.query<{ inventory_quantity: string }>(
                `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
                [item.product_id]
              )
              stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
              await client.query(`UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`, [
                extraQty,
                item.product_id,
              ])
            }
            await logStockMovement(client, {
              productId: item.product_id!,
              variantId: item.variant_id || null,
              subVariantId: item.sub_variant_id || null,
              transactionType: 'sale',
              quantityChange: -extraQty,
              referenceType: 'order',
              referenceId: id,
              currentStock: stockBefore,
            })
            await decrementNonPerishableShelfStock(
              client,
              item.product_id!,
              item.variant_id || null,
              item.sub_variant_id || null,
              extraQty
            )
          }
        }
      }

      return { moveToDraft, insufficientItems, shortfalls, savedItemIds }
    })

    if (result.moveToDraft) {
      return NextResponse.json({
        success: true,
        movedToDraft: true,
        insufficientItems: result.insufficientItems,
        insufficientDetails: result.shortfalls,
      })
    }

    if (order.invoice_number && customerEmail) {
      try {
        await sendInvoiceFinalizedEmail(
          customerEmail,
          customerName,
          order.invoice_number,
          totalAmount,
          undefined,
          await invoiceUrlForOrder(id)
        )
      } catch (_) {}
    }

    return NextResponse.json({ success: true, savedItemIds: result.savedItemIds })
  } catch (err: any) {
    console.error(`[admin/invoices/${(await params).id} PATCH] failed`, err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
