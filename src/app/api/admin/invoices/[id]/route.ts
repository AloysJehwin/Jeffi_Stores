import { NextRequest, NextResponse } from 'next/server'
import { productLabel } from '@/lib/product-label'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { isInterState, calculateGST, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear, round2 } from '@/lib/gst'
import { lineItemFromMrpIncl, lineItemExGst } from '@/lib/pricing'
import { logStockMovement } from '@/lib/inventory'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { syncPerishableStock, decrementNonPerishableShelfStock } from '@/lib/shelf'
import { deleteBatchIfEmpty } from '@/lib/inventory-deduct'
import { getFeatureFlags } from '@/lib/site-controls'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT id, source, invoice_number, status FROM orders WHERE id = $1`,
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (order.source !== 'offline') return NextResponse.json({ error: 'Only offline invoices can be edited' }, { status: 400 })

    const body = await request.json()
    const {
      customerName, customerPhone, customerEmail,
      addressLine1, addressLine2, city, state, postalCode,
      buyerGstin, paymentMode, invoiceDate, notes, items,
    } = body

    if (!customerName || !items?.length) {
      return NextResponse.json({ error: 'customerName and items are required' }, { status: 400 })
    }

    const sellerStateCode = process.env.BUSINESS_STATE_CODE || '33'
    const orderIsIgst = buyerGstin ? isInterState(state || '', sellerStateCode) : false

    // GST + inventory flags read once. When GST is off, invoice lines carry NO tax
    // (gst_rate 0, zero CGST/SGST/IGST) and are charged at the ex-GST equivalent —
    // same rule as cash-sale / orders-create.
    const { gstEnabled, inventoryValidationEnabled } = await getFeatureFlags()

    let subtotal = 0
    let totalTaxable = 0
    let totalCgst = 0
    let totalSgst = 0
    let totalIgst = 0

    const processedItems = items.map((item: any) => {
      const unitPrice = parseFloat(item.unit_price)
      const qty = parseFloat(item.quantity)
      const factor = item.sell_unit_factor && item.sell_unit_factor > 1 ? item.sell_unit_factor : 1
      const baseQty = qty * factor
      const discPct = parseFloat(item.discount_pct || '0') || 0
      const gstRate = parseFloat(item.gst_rate || '18')

      if (!gstEnabled) {
        // GST off ⇒ strip tax from the incl-GST price, apply discount, write zero tax.
        const exUnit = gstRate > 0 ? unitPrice / (1 + gstRate / 100) : unitPrice
        const lineTotal = round2(lineItemExGst(baseQty, exUnit, discPct))
        subtotal += lineTotal
        return {
          product_id: item.product_id || null,
          product_name: item.product_name,
          product_sku: item.product_sku || '',
          variant_id: item.variant_id || null,
          sub_variant_id: item.sub_variant_id || null,
          variant_name: item.variant_name || null,
          hsn_code: item.hsn_code || null,
          gst_rate: 0,
          quantity: qty,
          buy_unit: item.buy_unit || null,
          sold_unit_factor: factor > 1 ? factor : null,
          base_quantity: factor > 1 ? baseQty : null,
          unit_price: unitPrice,
          mrp: unitPrice,
          discount_pct: discPct,
          discount_amount: discPct > 0 ? round2(baseQty * exUnit * (discPct / 100)) : 0,
          total_price: lineTotal,
          taxable_amount: 0,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          tax_amount: 0,
        }
      }

      const lineTotal = round2(lineItemFromMrpIncl(baseQty, unitPrice, discPct, gstRate))
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
        sold_unit_factor: factor > 1 ? factor : null,
        base_quantity: factor > 1 ? baseQty : null,
        unit_price: unitPrice,
        mrp: unitPrice,
        discount_pct: discPct,
        discount_amount: discPct > 0 ? round2(baseQty * unitPrice / (1 + gstRate / 100) * (discPct / 100)) : 0,
        total_price: lineTotal,
        taxable_amount: round2(gst.taxableAmount),
        cgst_amount: round2(gst.cgst),
        sgst_amount: round2(gst.sgst),
        igst_amount: round2(gst.igst),
        tax_amount: round2(gst.cgst + gst.sgst + gst.igst),
      }
    })

    const taxAmount = round2(totalCgst + totalSgst + totalIgst)
    const totalAmount = round2(subtotal)
    const isPaid = paymentMode !== 'credit'
    const effectiveDate = invoiceDate || new Date().toISOString().slice(0, 10)

    const result = await withTransaction(async (client) => {
      const existingResult = await client.query<{ product_id: string | null; variant_id: string | null; sub_variant_id: string | null; quantity: string }>(
        `SELECT product_id, variant_id, sub_variant_id, quantity FROM order_items WHERE order_id = $1`,
        [id]
      )

      const existingQtyMap = new Map<string, number>()
      for (const r of existingResult.rows) {
        const key = `${r.product_id ?? ''}::${r.variant_id ?? ''}::${r.sub_variant_id ?? ''}`
        existingQtyMap.set(key, (existingQtyMap.get(key) ?? 0) + parseFloat(r.quantity))
      }

      const insufficientItems: string[] = []

      for (const item of (inventoryValidationEnabled ? processedItems : [])) {
        if (!item.product_id) continue
        const key = `${item.product_id}::${item.variant_id ?? ''}::${item.sub_variant_id ?? ''}`
        const previousQty = existingQtyMap.get(key) ?? 0
        const rawExtra = item.quantity - previousQty
        if (rawExtra <= 0) continue

        // Resolve unit factor: variant-scoped buy_unit → product-level buy_unit → sell_unit_id via variant → sell_unit_id via product
        const unitRow = await client.query<{ factor: string; dimension: string }>(
          `SELECT COALESCE(puv.factor, pup.factor, pu_sv.factor, pu_sp.factor)::text AS factor,
                  COALESCE(puv.dimension, pup.dimension, pu_sv.dimension, pu_sp.dimension) AS dimension
           FROM (SELECT 1) x
           LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3 AND $1 IS NOT NULL
           LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL AND $1 IS NOT NULL
             AND ($3 IS NULL OR puv.id IS NULL)
           LEFT JOIN product_variants pvar ON pvar.id = $3
           LEFT JOIN product_units pu_sv ON pu_sv.id = pvar.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL
           LEFT JOIN products prod ON prod.id = $2 AND $3 IS NULL
           LEFT JOIN product_units pu_sp ON pu_sp.id = prod.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL`,
          [item.buy_unit || null, item.product_id, item.variant_id || null]
        )
        const u = unitRow.rows[0]
        const extraQty = (u?.dimension === 'count' && u?.factor)
          ? rawExtra * parseFloat(u.factor)
          : rawExtra

        if (item.sub_variant_id) {
          const inv = await client.query<{ inventory_quantity: string }>(
            `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
            [item.sub_variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
          if (stock < extraQty) {
            insufficientItems.push(
              `${productLabel(item)} (available: ${stock}, extra needed: ${extraQty})`
            )
          }
        } else if (item.variant_id) {
          const inv = await client.query<{ inventory_quantity: string }>(
            `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
            [item.variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
          if (stock < extraQty) {
            insufficientItems.push(
              `${productLabel(item)} (available: ${stock}, extra needed: ${extraQty})`
            )
          }
        } else {
          const inv = await client.query<{ inventory_quantity: string }>(
            `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
            [item.product_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
          if (stock < extraQty) {
            insufficientItems.push(`${item.product_name} (available: ${stock}, extra needed: ${extraQty})`)
          }
        }
      }

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
          customerName, customerPhone || null, customerEmail || null,
          buyerGstin || null, orderIsIgst,
          subtotal, taxAmount, round2(totalTaxable),
          round2(totalCgst), round2(totalSgst), round2(totalIgst),
          totalAmount, isPaid ? 'paid' : 'unpaid',
          effectiveDate, notes || null,
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

      const savedItemIds: { product_id: string; variant_id: string | null; order_item_id: string }[] = []
      for (const item of processedItems) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name, sub_variant_name,
            hsn_code, gst_rate, quantity, buy_unit, sold_unit_factor, base_quantity,
            unit_price, mrp, discount_pct, discount_amount, total_price,
            taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
          [
            id, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.sub_variant_id, item.variant_name, item.sub_variant_name ?? null, item.hsn_code, item.gst_rate,
            item.quantity, item.buy_unit, item.sold_unit_factor ?? null, item.base_quantity ?? null,
            item.unit_price, item.mrp, item.discount_pct, item.discount_amount, item.total_price,
            item.taxable_amount, item.cgst_amount, item.sgst_amount, item.igst_amount, item.tax_amount,
          ]
        )
        savedItemIds.push({ product_id: item.product_id, variant_id: item.variant_id ?? null, order_item_id: inserted.rows[0].id })
      }

      if (!moveToDraft && inventoryValidationEnabled) {
        for (const item of processedItems) {
          if (!item.product_id) continue
          const key = `${item.product_id}::${item.variant_id ?? ''}::${item.sub_variant_id ?? ''}`
          const previousQty = existingQtyMap.get(key) ?? 0
          const rawExtra = item.quantity - previousQty
          if (rawExtra <= 0) continue

          const unitRow2 = await client.query<{ factor: string; dimension: string; qty_step: string | null }>(
            `SELECT COALESCE(puv.factor, pup.factor, pu_sv.factor, pu_sp.factor)::text AS factor,
                    COALESCE(puv.dimension, pup.dimension, pu_sv.dimension, pu_sp.dimension) AS dimension,
                    COALESCE(puv.qty_step, pup.qty_step, pu_sv.qty_step, pu_sp.qty_step)::text AS qty_step
             FROM (SELECT 1) x
             LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3 AND $1 IS NOT NULL
             LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL AND $1 IS NOT NULL
               AND ($3 IS NULL OR puv.id IS NULL)
             LEFT JOIN product_variants pvar ON pvar.id = $3
             LEFT JOIN product_units pu_sv ON pu_sv.id = pvar.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL
             LEFT JOIN products prod ON prod.id = $2 AND $3 IS NULL
             LEFT JOIN product_units pu_sp ON pu_sp.id = prod.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL`,
            [item.buy_unit || null, item.product_id, item.variant_id || null]
          )
          const u2 = unitRow2.rows[0]
          const extraQty = (u2?.dimension === 'count' && u2?.factor)
            ? rawExtra * parseFloat(u2.factor)
            : rawExtra

          const prodRow = await client.query<{ perishable: boolean; serialized: boolean }>(
            `SELECT perishable, serialized FROM products WHERE id = $1`, [item.product_id]
          )
          const { perishable, serialized } = prodRow.rows[0] ?? { perishable: false, serialized: false }

          let stockBefore = 0

          if (perishable) {
            // Deduct from batches FIFO (earliest expiry first)
            const batches = await client.query<{ id: string; quantity_remaining: string; lot_number: string | null; expiry_date: string | null }>(
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
            const stepVal = parseFloat(u2?.qty_step ?? '1') || 1
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
                [id, item.id ?? null, serial.id]
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
              await client.query(
                `UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
                [extraQty, item.product_id]
              )
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
            await decrementNonPerishableShelfStock(client, item.product_id!, item.variant_id || null, item.sub_variant_id || null, extraQty)
          }
        }
      }

      return { moveToDraft, insufficientItems, savedItemIds }
    })

    if (result.moveToDraft) {
      return NextResponse.json({
        success: true,
        movedToDraft: true,
        insufficientItems: result.insufficientItems,
      })
    }

    if (order.invoice_number && customerEmail) {
      try {
        await sendInvoiceFinalizedEmail(customerEmail, customerName, order.invoice_number, totalAmount)
      } catch (_) {}
    }

    return NextResponse.json({ success: true, savedItemIds: result.savedItemIds })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
