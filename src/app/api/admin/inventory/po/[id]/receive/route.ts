import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, getClient } from '@/lib/db'
import { round2 } from '@/lib/gst'
import { logStockMovement, updateWeightedAvgCost } from '@/lib/inventory'
import { adjustStock } from '@/lib/shelf'
import { sendPOReceiveNotificationEmail } from '@/lib/email'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const postSchema = z.object({
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
        manufacture_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        location_id: zUuid.nullish(),
      })
    )
    .min(1, 'At least one item is required'),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const { received_date, notes } = body

    const parsed = parseBody(postSchema, body, 'POST /api/admin/inventory/po/[id]/receive')
    if (!parsed.ok) return parsed.response
    const { items } = parsed.data

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
    const countRow = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM grns WHERE grn_number LIKE $1`,
      [`GRN-${datePart}-%`]
    )
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
        [grnNumber, id, po.supplier_id,
         received_date || new Date().toISOString().slice(0, 10),
         notes || null]
      )
      const grnId = grnRow.rows[0].id

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
          `INSERT INTO grn_items (grn_id, po_item_id, product_id, variant_id, quantity_received, unit_cost, purchase_unit_factor)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [grnId, poItemId, productId, variantId, qtyReceived, unitCost, factor]
        )

        await updateWeightedAvgCost(client, { productId, variantId, qtyReceived, unitCost })

        let stockBefore = 0
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

        await logStockMovement(client, {
          productId,
          variantId,
          subVariantId,
          transactionType: 'purchase',
          quantityChange: qtyReceived,
          referenceType: 'grn',
          referenceId: grnId,
          currentStock: stockBefore,
        })

        // Batch capture for perishable products — mandatory expiry_date required
        const productRow = await client.query<{ perishable: boolean }>(
          'SELECT perishable FROM products WHERE id = $1',
          [productId]
        )
        if (productRow.rows[0]?.perishable) {
          if (!item.expiry_date) {
            throw new Error(`Product ${productId} is perishable — expiry_date is required for GRN receive`)
          }
          await client.query(
            `INSERT INTO product_batches
               (product_id, variant_id, sub_variant_id, grn_id, lot_number, manufacture_date, expiry_date, quantity, quantity_remaining, location_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)`,
            [
              productId, variantId, subVariantId, grnId,
              item.lot_number || null,
              item.manufacture_date || null,
              item.expiry_date,
              qtyReceived,
              item.location_id || null,
            ]
          )
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
      const allReceived = poItems.rows.every(
        r => parseFloat(r.quantity_received) >= parseFloat(r.quantity)
      )
      const anyReceived = poItems.rows.some(r => parseFloat(r.quantity_received) > 0)
      const newStatus = allReceived ? 'received' : anyReceived ? 'partial' : po.status

      await client.query(
        `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, id]
      )

      await client.query('COMMIT')

      // Update shelf_stock for any item that had a location assigned
      for (const item of items) {
        if (!item.location_id) continue
        const factor = item.purchase_unit_factor ?? 1
        const qtyReceived = item.quantity_received * factor
        if (qtyReceived <= 0) continue
        try {
          await adjustStock(
            item.location_id,
            item.product_id,
            item.variant_id || null,
            item.sub_variant_id || null,
            qtyReceived,
            `GRN receive — PO ${po.po_number}`,
            admin.id,
          )
        } catch (_) {}
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
            (s, r) => s + parseFloat(r.quantity_received) * parseFloat(r.unit_cost) * parseFloat(r.tax_rate) / 100, 0
          )
          const expSeq = await expClient.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM expenses')
          const expenseNumber = `EXP-${String((parseInt(expSeq.rows[0]?.count || '0') + 1)).padStart(4, '0')}`
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

      return NextResponse.json({ success: true, grn_id: grnId, grn_number: grnNumber })
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