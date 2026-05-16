import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany, getClient } from '@/lib/db'
import { logStockMovement, updateWeightedAvgCost } from '@/lib/inventory'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { received_date, notes, items } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 })
    }

    const po = await queryOne<any>(
      `SELECT po.*, s.id AS supplier_id, s.name AS supplier_name FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1`,
      [params.id]
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
      const qty = parseFloat(item.quantity_received) || 0
      const cost = parseFloat(item.unit_cost) || 0
      if (qty > 0) receivedAmount += qty * cost
    }

    const client = await getClient()
    try {
      await client.query('BEGIN')

      const grnRow = await client.query<{ id: string }>(
        `INSERT INTO grns (grn_number, po_id, supplier_id, received_date, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [grnNumber, params.id, po.supplier_id,
         received_date || new Date().toISOString().slice(0, 10),
         notes || null]
      )
      const grnId = grnRow.rows[0].id

      for (const item of items) {
        const qtyReceived = parseFloat(item.quantity_received) || 0
        if (qtyReceived <= 0) continue

        const unitCost = parseFloat(item.unit_cost) || 0
        const poItemId = item.po_item_id
        const productId = item.product_id
        const variantId = item.variant_id || null

        await client.query(
          `INSERT INTO grn_items (grn_id, po_item_id, product_id, variant_id, quantity_received, unit_cost)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [grnId, poItemId, productId, variantId, qtyReceived, unitCost]
        )

        await updateWeightedAvgCost(client, { productId, variantId, qtyReceived, unitCost })

        if (variantId) {
          await client.query(
            `UPDATE product_variants SET inventory_quantity = COALESCE(inventory_quantity,0) + $1 WHERE id = $2`,
            [qtyReceived, variantId]
          )
        } else {
          await client.query(
            `UPDATE products SET inventory_quantity = COALESCE(inventory_quantity,0) + $1 WHERE id = $2`,
            [qtyReceived, productId]
          )
        }

        await logStockMovement(client, {
          productId,
          variantId,
          transactionType: 'purchase',
          quantityChange: qtyReceived,
          referenceType: 'grn',
          referenceId: grnId,
        })

        await client.query(
          `UPDATE purchase_order_items
           SET quantity_received = COALESCE(quantity_received,0) + $1
           WHERE id = $2`,
          [qtyReceived, poItemId]
        )
      }

      const poItems = await client.query<{ quantity: string; quantity_received: string }>(
        `SELECT quantity, quantity_received FROM purchase_order_items WHERE po_id = $1`,
        [params.id]
      )
      const allReceived = poItems.rows.every(
        r => parseFloat(r.quantity_received) >= parseFloat(r.quantity)
      )
      const anyReceived = poItems.rows.some(r => parseFloat(r.quantity_received) > 0)
      const newStatus = allReceived ? 'received' : anyReceived ? 'partial' : po.status

      await client.query(
        `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, params.id]
      )

      await client.query('COMMIT')

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
              Math.round(receivedAmount * 100) / 100,
              Math.round(receivedTax * 100) / 100,
              Math.round((receivedAmount + receivedTax) * 100) / 100,
              receiveDate,
              params.id,
              grnId,
            ]
          )
          await expClient.query('COMMIT')
        } catch {
          await expClient.query('ROLLBACK')
        } finally {
          expClient.release()
        }
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
