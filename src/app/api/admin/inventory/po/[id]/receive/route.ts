import { NextRequest, NextResponse } from 'next/server'
import { resolveGrainUnit } from '@/lib/selling-unit'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, getClient } from '@/lib/db'
import { round2 } from '@/lib/gst'
import { logStockMovement, updateWeightedAvgCost, recomputeStockStatusForProduct } from '@/lib/inventory'
import { adjustStock, syncPerishableStock, getOrCreateOpenShelf } from '@/lib/shelf'
import { sendPOReceiveNotificationEmail } from '@/lib/email'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const postSchema = z.object({
  warehouse_id: zUuid.nullish(),
  items: z
    .array(
      z.object({
        po_item_id: zUuid,
        product_id: zUuid,
        variant_id: zUuid.nullish(),
        sub_variant_id: zUuid.nullish(),
        quantity_received: z.coerce.number().positive(),
        unit_cost: z.coerce.number().min(0),
        purchase_unit_factor: z.coerce.number().positive().default(1),
        lot_number: z.string().nullish(),
        manufacture_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        expiry_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        location_id: zUuid.nullish(),
        serial_numbers: z.array(z.string().min(1)).nullish(),
      })
    )
    .min(1, 'At least one item is required'),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const { received_date, notes } = body

    const parsed = parseBody(postSchema, body, 'POST /api/admin/inventory/po/[id]/receive')
    if (!parsed.ok) return parsed.response
    const { items, warehouse_id: warehouseId } = parsed.data

    // Default missing location_id to the warehouse's open shelf
    if (warehouseId) {
      const wRow = await queryOne<{ code: string }>(`SELECT code FROM warehouses WHERE id = $1`, [warehouseId])
      if (wRow) {
        const openShelfId = await getOrCreateOpenShelf(warehouseId, wRow.code)
        for (const item of items) {
          if (!item.location_id) item.location_id = openShelfId
        }
      }
    }

    const po = await queryOne<any>(
      `SELECT po.*, s.id AS supplier_id, s.name AS supplier_name, s.contact_name, s.email AS supplier_email
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1`,
      [id]
    )
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 })
    if (po.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot receive against a cancelled PO' }, { status: 400 })
    }

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const countRow = await queryOne<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM grns WHERE grn_number LIKE $1`, [
      `GRN-${datePart}-%`,
    ])
    const seq = String((countRow?.cnt || 0) + 1).padStart(4, '0')
    const grnNumber = `GRN-${datePart}-${seq}`

    let receivedAmount = 0
    for (const item of items) {
      const factor = item.purchase_unit_factor ?? 1
      const qty = item.quantity_received * factor
      const cost = item.unit_cost
      if (qty > 0) receivedAmount += qty * cost
    }

    const client = await getClient()
    try {
      await client.query('BEGIN')

      const grnRow = await client.query<{ id: string }>(
        `INSERT INTO grns (grn_number, po_id, supplier_id, received_date, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [grnNumber, id, po.supplier_id, received_date || new Date().toISOString().slice(0, 10), notes || null]
      )
      const grnId = grnRow.rows[0].id
      const batchTrackedProductIds = new Set<string>()
      // Collected for the label-printing popup: batches created + serials received.
      const createdBatchIds: string[] = []
      const createdSerials: string[] = []

      for (const item of items) {
        const factor = item.purchase_unit_factor ?? 1
        // quantity_received is in purchase units; convert to base units for stock
        const qtyReceived = item.quantity_received * factor
        if (qtyReceived <= 0) continue

        const unitCost = item.unit_cost
        const poItemId = item.po_item_id
        const productId = item.product_id
        const variantId = item.variant_id || null
        const subVariantId = item.sub_variant_id || null

        await client.query(
          `INSERT INTO grn_items (grn_id, po_item_id, product_id, variant_id, sub_variant_id, quantity_received, unit_cost, purchase_unit_factor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [grnId, poItemId, productId, variantId, subVariantId, qtyReceived, unitCost, factor]
        )

        await updateWeightedAvgCost(client, { productId, variantId, subVariantId, qtyReceived, unitCost })

        // Fetch perishable + serialized flags
        const productRow = await client.query<{ perishable: boolean; serialized: boolean }>(
          'SELECT perishable, serialized FROM products WHERE id = $1',
          [productId]
        )
        const isPerishable = productRow.rows[0]?.perishable ?? false
        const isSerialised = productRow.rows[0]?.serialized ?? false
        // Serials hang off a batch and the shelf/central sync is batch-driven, so a
        // serialized receipt gets a batch even when the product is not perishable.
        const isTracked = isPerishable || isSerialised
        if (isTracked) batchTrackedProductIds.add(productId)

        // Validate serial numbers upfront (before any inserts)
        const serials = item.serial_numbers ?? []
        if (isSerialised) {
          // Serial count follows the same rule as the sale side: one serial per
          // qty_step of BASE quantity. qtyReceived is already in base units
          // (receive_qty × purchase_unit_factor), so expected = qtyReceived / qty_step.
          // Resolve at the most specific grain that defines a base unit — sub-variant,
          // then variant, then product. The old lookup went through sell_unit_id, which
          // sub-variants do not have, so a sub-variant silently used its parent's step.
          const grainUnit = await resolveGrainUnit(client, { productId, variantId, subVariantId })
          const qtyStep = grainUnit && grainUnit.qty_step > 0 ? grainUnit.qty_step : 1
          const expectedSerials = Math.round(qtyReceived / (qtyStep > 0 ? qtyStep : 1))
          if (serials.filter(Boolean).length !== expectedSerials) {
            throw new Error(
              `Product ${productId} is serialized — expected ${expectedSerials} serial number(s) ` +
                `(${qtyReceived} base units ÷ ${qtyStep} qty_step), got ${serials.filter(Boolean).length}`
            )
          }
          if (serials.length > 0) {
            const dupeCheck = await client.query<{ serial_number: string }>(
              `SELECT serial_number FROM product_serials WHERE product_id = $1 AND serial_number = ANY($2) AND status != 'sold'`,
              [productId, serials]
            )
            if (dupeCheck.rows.length > 0) {
              throw new Error(
                `Duplicate serial numbers already in stock: ${dupeCheck.rows.map(r => r.serial_number).join(', ')}`
              )
            }
          }
        }

        let stockBefore = 0
        let newBatchId: string | null = null

        if (isTracked) {
          if (isPerishable && !item.expiry_date) {
            throw new Error(`Product ${productId} is perishable — expiry_date is required for GRN receive`)
          }
          // Stock lives only in product_batches; read current batch total for ledger
          const batchStockRow = await client.query<{ total: string }>(
            `SELECT COALESCE(SUM(quantity_remaining), 0)::text AS total FROM product_batches
             WHERE product_id = $1
               AND (variant_id = $2 OR ($2 IS NULL AND variant_id IS NULL))
               AND (sub_variant_id = $3 OR ($3 IS NULL AND sub_variant_id IS NULL))`,
            [productId, variantId, subVariantId]
          )
          stockBefore = parseFloat(batchStockRow.rows[0]?.total ?? '0') || 0
          const batchInsert = await client.query<{ id: string }>(
            `INSERT INTO product_batches
               (product_id, variant_id, sub_variant_id, grn_id, lot_number, manufacture_date, expiry_date, quantity, quantity_remaining, location_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING id`,
            [
              productId,
              variantId,
              subVariantId,
              grnId,
              item.lot_number || null,
              item.manufacture_date || null,
              item.expiry_date || null,
              qtyReceived,
              item.location_id || null,
            ]
          )
          newBatchId = batchInsert.rows[0].id
          createdBatchIds.push(newBatchId)
        } else {
          if (subVariantId) {
            const row = await client.query<{ inventory_quantity: string }>(
              `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
              [subVariantId]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              `UPDATE product_sub_variants SET inventory_quantity = COALESCE(inventory_quantity,0) + $1 WHERE id = $2`,
              [qtyReceived, subVariantId]
            )
          } else if (variantId) {
            const row = await client.query<{ inventory_quantity: string }>(
              `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
              [variantId]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              `UPDATE product_variants SET inventory_quantity = COALESCE(inventory_quantity,0) + $1 WHERE id = $2`,
              [qtyReceived, variantId]
            )
          } else {
            const row = await client.query<{ inventory_quantity: string }>(
              `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
              [productId]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              `UPDATE products SET inventory_quantity = COALESCE(inventory_quantity,0) + $1 WHERE id = $2`,
              [qtyReceived, productId]
            )
          }
        }

        // Insert product_serials rows + one ledger entry per serial unit
        if (isSerialised && serials.length > 0) {
          for (let si = 0; si < serials.length; si++) {
            const sn = serials[si]
            createdSerials.push(sn)
            await client.query(
              `INSERT INTO product_serials
                 (product_id, variant_id, sub_variant_id, batch_id, grn_id, serial_number, receive_seq, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'in_stock')`,
              [productId, variantId, subVariantId, newBatchId, grnId, sn, si]
            )
            await logStockMovement(client, {
              productId,
              variantId,
              subVariantId,
              transactionType: 'purchase',
              quantityChange: 1,
              referenceType: 'grn',
              referenceId: grnId,
              currentStock: stockBefore + si,
              ...(newBatchId ? { batchId: newBatchId } : {}),
              lotNumber: item.lot_number || null,
              expiryDate: item.expiry_date || null,
              serialNumber: sn,
            })
          }
        } else {
          await logStockMovement(client, {
            productId,
            variantId,
            subVariantId,
            transactionType: 'purchase',
            quantityChange: qtyReceived,
            referenceType: 'grn',
            referenceId: grnId,
            currentStock: stockBefore,
            ...(newBatchId ? { batchId: newBatchId } : {}),
            lotNumber: item.lot_number || null,
            expiryDate: item.expiry_date || null,
          })
        }

        await client.query(
          `UPDATE purchase_order_items
           SET quantity_received = COALESCE(quantity_received,0) + $1
           WHERE id = $2`,
          [qtyReceived, poItemId]
        )
      }

      const poItems = await client.query<{ quantity: string; quantity_received: string }>(
        `SELECT quantity, quantity_received FROM purchase_order_items WHERE po_id = $1`,
        [id]
      )
      const allReceived = poItems.rows.every(r => parseFloat(r.quantity_received) >= parseFloat(r.quantity))
      const anyReceived = poItems.rows.some(r => parseFloat(r.quantity_received) > 0)
      const newStatus = allReceived ? 'received' : anyReceived ? 'partial' : po.status

      await client.query(`UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, id])

      // If inventory_sync is ON, derive stock_status from the received quantities,
      // in-transaction (deduped per product). No-op when OFF. Covers the
      // non-perishable direct bumps (incl. the no-shelf-location case). Perishable
      // items are re-derived post-commit by syncPerishableStock → syncCentralInventory
      // (idempotent), so any pre-sync value here is harmless.
      const statusSyncedPids = new Set<string>()
      for (const item of items) {
        if (!item.product_id || statusSyncedPids.has(item.product_id)) continue
        statusSyncedPids.add(item.product_id)
        await recomputeStockStatusForProduct(client, item.product_id)
      }

      await client.query('COMMIT')

      // Update shelf_stock for any item that had a location assigned.
      // Batch-tracked (perishable or serialized): recompute shelf_stock from
      // product_batches then sync inventory_quantity. Plain: adjustStock directly.
      const syncedPerishable = new Set<string>()
      const shelfWarnings: string[] = []
      for (const item of items) {
        const factor = item.purchase_unit_factor ?? 1
        const qtyReceived = item.quantity_received * factor
        if (qtyReceived <= 0) continue
        try {
          if (batchTrackedProductIds.has(item.product_id)) {
            const key = `${item.product_id}:${item.variant_id || ''}:${item.sub_variant_id || ''}`
            if (!syncedPerishable.has(key)) {
              syncedPerishable.add(key)
              await syncPerishableStock(null, item.product_id, item.variant_id || null, item.sub_variant_id || null)
            }
          } else if (item.location_id) {
            await adjustStock(
              item.location_id,
              item.product_id,
              item.variant_id || null,
              item.sub_variant_id || null,
              qtyReceived,
              `GRN receive — PO ${po.po_number}`,
              admin.id
            )
          } else {
            // Non-perishable with no shelf location: inventory_quantity was bumped but
            // shelf_stock cannot be — flag so the divergence is visible, not silent.
            shelfWarnings.push(
              `No shelf location for product ${item.product_id} — stock added but not placed on a shelf.`
            )
          }
        } catch (err: any) {
          shelfWarnings.push(`Shelf update failed for product ${item.product_id}: ${err?.message || 'unknown error'}`)
        }
      }

      if (receivedAmount > 0) {
        const expClient = await getClient()
        try {
          await expClient.query('BEGIN')
          const taxResult = await expClient.query<{ tax_rate: string; quantity_received: string; unit_cost: string }>(
            `SELECT poi.tax_rate, gi.quantity_received, gi.unit_cost
             FROM grn_items gi
             JOIN purchase_order_items poi ON poi.id = gi.po_item_id
             WHERE gi.grn_id = $1`,
            [grnId]
          )
          const receivedTax = taxResult.rows.reduce(
            (s, r) => s + (parseFloat(r.quantity_received) * parseFloat(r.unit_cost) * parseFloat(r.tax_rate)) / 100,
            0
          )
          const expSeq = await expClient.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM expenses')
          const expenseNumber = `EXP-${String(parseInt(expSeq.rows[0]?.count || '0') + 1).padStart(4, '0')}`
          const receiveDate = received_date || new Date().toISOString().slice(0, 10)
          await expClient.query(
            `INSERT INTO expenses (expense_number, supplier_name, description, amount, tax_amount, total_amount, expense_date, status, po_id, grn_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'unpaid',$8,$9)`,
            [
              expenseNumber,
              po.supplier_name,
              `GRN ${grnNumber} — PO ${po.po_number}`,
              round2(receivedAmount),
              round2(receivedTax),
              round2(receivedAmount + receivedTax),
              receiveDate,
              id,
              grnId,
            ]
          )
          await expClient.query('COMMIT')
        } catch (err) {
          await expClient.query('ROLLBACK')
        } finally {
          expClient.release()
        }
      }

      if (po?.supplier_email) {
        try {
          const grnItemsForEmail = await queryMany<any>(
            `SELECT gi.quantity_received, gi.unit_cost,
                    COALESCE(poi.product_name, p.name) AS product_name,
                    pv.variant_name
             FROM grn_items gi
             JOIN purchase_order_items poi ON poi.id = gi.po_item_id
             LEFT JOIN products p ON p.id = gi.product_id
             LEFT JOIN product_variants pv ON pv.id = gi.variant_id
             WHERE gi.grn_id = $1`,
            [grnId]
          )
          await sendPOReceiveNotificationEmail(
            po.supplier_email,
            po.contact_name || '',
            po.supplier_name,
            po.po_number,
            grnNumber,
            newStatus,
            (grnItemsForEmail || []).map((it: any) => ({
              product_name: it.product_name,
              variant_name: it.variant_name,
              quantity_received: parseFloat(it.quantity_received),
              unit_cost: parseFloat(it.unit_cost),
            }))
          )
        } catch (_) {}
      }

      return NextResponse.json({
        success: true,
        grn_id: grnId,
        grn_number: grnNumber,
        batch_ids: createdBatchIds,
        serial_numbers: createdSerials,
        ...(shelfWarnings.length ? { warnings: shelfWarnings } : {}),
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
