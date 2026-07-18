import { withTransaction } from '@/lib/db'
import type { PoolClient } from 'pg'
import { logStockMovement } from '@/lib/inventory'
import { syncPerishableStock } from '@/lib/shelf'
import { toSellingUnit, toBaseQuantity, serialCountForQuantity } from '@/lib/selling-unit'

/**
 * Deducts inventory for an order at confirmation time — the counterpart to
 * `restoreOrderStock` in order-stock.ts.
 *
 * Handles all three product kinds against the selling-unit quantity:
 *  - plain      → decrement inventory_quantity (+ non-perishable shelf_stock) by base qty
 *  - perishable → consume product_batches FEFO (nearest expiry first), spanning batches
 *  - serialized → mark N serials sold (N = qty / qty_step) FEFO by batch expiry
 *
 * Two modes, so BOTH sale surfaces keep working:
 *  - MANUAL: the admin batch/serial picker popups pass explicit `batchAssignments`
 *    / `serialAssignments` (shape identical to BatchPickerModal/SerialEntryModal).
 *    Used = respected verbatim.
 *  - AUTO: when no assignments are given for an item (online checkout), the helper
 *    auto-picks batches/serials by FEFO.
 *
 * Idempotent: if a 'sale' ledger row already exists for the order it is a no-op,
 * so payment-webhook retries / re-confirmation never double-deduct.
 *
 * Runs inside the caller's transaction when `txClient` is provided; otherwise
 * opens its own.
 */

export interface BatchAssignment {
  order_item_id: string
  batch_id: string
  qty: number
}
export interface SerialAssignment {
  order_item_id: string
  serial_number: string
}
export interface DeductOptions {
  batchAssignments?: BatchAssignment[]
  serialAssignments?: SerialAssignment[]
  /**
   * When true, serialized items MUST have explicit serialAssignments (no
   * auto-pick) — throws otherwise. Preserves the admin picker-popup contract
   * where the operator selects serials. Online checkout leaves this false so
   * serials are auto-picked FEFO. Batches always fall back to auto-FEFO.
   */
  requireSerialAssignments?: boolean
}

const FEFO_ORDER = 'ORDER BY expiry_date ASC NULLS LAST, manufacture_date ASC NULLS LAST, created_at ASC'

interface OrderItemRow {
  id: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  product_name: string
  variant_name: string | null
  quantity: string
  buy_unit: string | null
}

export async function deductOrderStock(
  orderId: string,
  opts: DeductOptions = {},
  txClient?: PoolClient
): Promise<void> {
  const run = (client: PoolClient) => deductInTx(client, orderId, opts)
  if (txClient) return run(txClient)
  return withTransaction(run)
}

/**
 * Same deduction logic keyed on an explicit line-item list rather than reading
 * order_items by orderId. For sale surfaces that don't persist order_items
 * (cash-sale keyed on sale_id, invoice edits). `referenceId` is the id recorded
 * on the ledger / product_serials.order_id (a sale id or order id). Each line's
 * `id` is used to match manual batch/serial assignments (pass any stable key
 * when there are none). Runs inside the caller's transaction.
 */
export async function deductStockForLines(
  client: PoolClient,
  referenceId: string,
  lines: LineItem[],
  opts: DeductOptions = {}
): Promise<void> {
  await deductItems(
    client,
    referenceId,
    lines.map(l => ({
      id: l.id,
      product_id: l.product_id,
      variant_id: l.variant_id ?? null,
      sub_variant_id: l.sub_variant_id ?? null,
      product_name: l.product_name ?? '',
      variant_name: l.variant_name ?? null,
      quantity: String(l.quantity),
      buy_unit: l.buy_unit ?? null,
    })),
    opts
  )
}

export interface LineItem {
  id: string
  product_id: string
  variant_id?: string | null
  sub_variant_id?: string | null
  product_name?: string | null
  variant_name?: string | null
  quantity: number | string
  buy_unit?: string | null
}

async function deductInTx(client: PoolClient, orderId: string, opts: DeductOptions): Promise<void> {
  // Idempotency guard — mirror restoreOrderStock's 'return' guard.
  const already = await client.query(
    `SELECT 1 FROM inventory_transactions
      WHERE reference_type = 'order' AND reference_id = $1 AND transaction_type = 'sale'
      LIMIT 1`,
    [orderId]
  )
  if (already.rows.length > 0) return

  const items = await client.query<OrderItemRow>(
    `SELECT id, product_id, variant_id, sub_variant_id, product_name, variant_name, quantity, buy_unit
       FROM order_items WHERE order_id = $1`,
    [orderId]
  )
  await deductItems(client, orderId, items.rows, opts)
}

async function deductItems(
  client: PoolClient,
  referenceId: string,
  itemRows: OrderItemRow[],
  opts: DeductOptions
): Promise<void> {
  const touchedPerishable: { productId: string; variantId: string | null; subVariantId: string | null }[] = []

  for (const item of itemRows) {
    if (!item.product_id) continue
    const qty = parseFloat(item.quantity)

    // Resolve selling unit (factor/dimension/qty_step) — variant row wins over product-level.
    const unitRow = await client.query(
      `SELECT COALESCE(puv.unit, pup.unit) AS unit,
              COALESCE(puv.factor, pup.factor)::text AS factor,
              COALESCE(puv.dimension, pup.dimension) AS dimension,
              COALESCE(puv.qty_step, pup.qty_step)::text AS qty_step,
              COALESCE(puv.min_qty, pup.min_qty)::text AS min_qty,
              COALESCE(puv.max_qty, pup.max_qty)::text AS max_qty
         FROM (SELECT 1) x
         LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3
         LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL`,
      [item.buy_unit || null, item.product_id, item.variant_id || null]
    )
    const unit = toSellingUnit(unitRow.rows[0])
    const baseQty = toBaseQuantity(qty, unit)

    const prod = await client.query<{ perishable: boolean; serialized: boolean }>(
      `SELECT perishable, serialized FROM products WHERE id = $1`,
      [item.product_id]
    )
    const isSerialized = !!prod.rows[0]?.serialized
    const isPerishable = !!prod.rows[0]?.perishable

    const manualBatches = (opts.batchAssignments ?? []).filter(a => a.order_item_id === item.id)
    const manualSerials = (opts.serialAssignments ?? []).filter(a => a.order_item_id === item.id)
    const label = `${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''}`

    if (isSerialized) {
      const needed = unit ? serialCountForQuantity(qty, unit) : Math.round(baseQty)
      if (opts.requireSerialAssignments && manualSerials.length < needed) {
        throw new Error(
          `Serial numbers required for "${label}" — need ${needed}, got ${manualSerials.length}`
        )
      }
      await deductSerialized(client, referenceId, item, baseQty, needed, manualSerials, label)
      touchedPerishable.push({ productId: item.product_id, variantId: item.variant_id, subVariantId: item.sub_variant_id })
    } else if (isPerishable) {
      await deductPerishable(client, referenceId, item, baseQty, manualBatches, label)
      touchedPerishable.push({ productId: item.product_id, variantId: item.variant_id, subVariantId: item.sub_variant_id })
    } else {
      await deductPlain(client, referenceId, item, baseQty, label)
    }
  }

  // Rebuild shelf_stock from batches for every perishable/serialized product touched.
  for (const t of touchedPerishable) {
    await syncPerishableStock(client, t.productId, t.variantId, t.subVariantId)
  }
}

/** Perishable: consume batches FEFO (manual assignments respected if provided). */
async function deductPerishable(
  client: PoolClient,
  orderId: string,
  item: OrderItemRow,
  baseQty: number,
  manual: BatchAssignment[],
  label: string
): Promise<void> {
  // Build the consumption plan: manual assignments, or auto-FEFO.
  let plan: { batch_id: string; qty: number }[]
  if (manual.length > 0) {
    plan = manual.map(a => ({ batch_id: a.batch_id, qty: a.qty }))
    const total = plan.reduce((s, p) => s + p.qty, 0)
    if (total + 1e-6 < baseQty) {
      throw new Error(`Batch total (${total}) is less than required (${baseQty}) for "${label}"`)
    }
  } else {
    const avail = await client.query<{ id: string; quantity_remaining: string }>(
      `SELECT id, quantity_remaining FROM product_batches
        WHERE product_id = $1
          AND (variant_id = $2 OR ($2 IS NULL AND variant_id IS NULL))
          AND (sub_variant_id = $3 OR ($3 IS NULL AND sub_variant_id IS NULL))
          AND quantity_remaining > 0
        ${FEFO_ORDER}
        FOR UPDATE`,
      [item.product_id, item.variant_id, item.sub_variant_id]
    )
    plan = []
    let remaining = baseQty
    for (const b of avail.rows) {
      if (remaining <= 1e-6) break
      const take = Math.min(remaining, parseFloat(b.quantity_remaining) || 0)
      if (take > 0) { plan.push({ batch_id: b.id, qty: take }); remaining -= take }
    }
    if (remaining > 1e-6) {
      throw new Error(`Insufficient batch stock for "${label}" — short by ${remaining.toFixed(3)}`)
    }
  }

  for (const p of plan) {
    const br = await client.query<{ quantity_remaining: string }>(
      `SELECT quantity_remaining FROM product_batches WHERE id = $1 FOR UPDATE`, [p.batch_id]
    )
    const before = parseFloat(br.rows[0]?.quantity_remaining ?? '0') || 0
    if (before + 1e-6 < p.qty) {
      throw new Error(`Insufficient batch stock for "${label}" — batch has ${before}, taking ${p.qty}`)
    }
    const upd = await client.query<{ lot_number: string | null; expiry_date: string | null }>(
      `UPDATE product_batches SET quantity_remaining = quantity_remaining - $1, updated_at = NOW()
        WHERE id = $2 RETURNING lot_number, expiry_date`,
      [p.qty, p.batch_id]
    )
    await logStockMovement(client, {
      productId: item.product_id,
      variantId: item.variant_id,
      subVariantId: item.sub_variant_id,
      transactionType: 'sale',
      quantityChange: -p.qty,
      referenceType: 'order',
      referenceId: orderId,
      currentStock: before,
      batchId: p.batch_id,
      lotNumber: upd.rows[0]?.lot_number ?? null,
      expiryDate: upd.rows[0]?.expiry_date ?? null,
    })
  }
  // Tag order_item with the first (nearest-expiry) batch for display.
  await client.query(`UPDATE order_items SET batch_id = $1 WHERE id = $2`, [plan[0].batch_id, item.id])
}

/** Serialized: mark `count` serials sold FEFO; each serial deducts 1 from its batch. */
async function deductSerialized(
  client: PoolClient,
  orderId: string,
  item: OrderItemRow,
  baseQty: number,
  count: number,
  manual: SerialAssignment[],
  label: string
): Promise<void> {
  let serials: { id: string; serial_number: string; batch_id: string | null }[]
  if (manual.length > 0) {
    serials = []
    for (const a of manual) {
      const r = await client.query<{ id: string; batch_id: string | null }>(
        `SELECT id, batch_id FROM product_serials
          WHERE product_id = $1 AND serial_number = $2 AND status = 'in_stock' FOR UPDATE`,
        [item.product_id, a.serial_number]
      )
      if (!r.rows.length) throw new Error(`Serial "${a.serial_number}" for "${label}" is not available`)
      serials.push({ id: r.rows[0].id, serial_number: a.serial_number, batch_id: r.rows[0].batch_id })
    }
  } else {
    const r = await client.query<{ id: string; serial_number: string; batch_id: string | null }>(
      `SELECT ps.id, ps.serial_number, ps.batch_id
         FROM product_serials ps
         LEFT JOIN product_batches pb ON pb.id = ps.batch_id
        WHERE ps.product_id = $1
          AND (ps.variant_id = $2 OR ($2 IS NULL AND ps.variant_id IS NULL))
          AND (ps.sub_variant_id = $3 OR ($3 IS NULL AND ps.sub_variant_id IS NULL))
          AND ps.status = 'in_stock'
        ORDER BY pb.expiry_date ASC NULLS LAST, ps.received_at ASC
        LIMIT $4
        FOR UPDATE OF ps`,
      [item.product_id, item.variant_id, item.sub_variant_id, count]
    )
    serials = r.rows
    if (serials.length < count) {
      throw new Error(`Not enough serial units for "${label}" — need ${count}, have ${serials.length}`)
    }
  }

  for (let i = 0; i < serials.length; i++) {
    const s = serials[i]
    await client.query(
      `UPDATE product_serials SET status = 'sold', order_id = $1, order_item_id = $2, sold_at = NOW(), updated_at = NOW()
        WHERE id = $3`,
      [orderId, item.id, s.id]
    )
    let lotNumber: string | null = null
    let expiryDate: string | null = null
    if (s.batch_id) {
      const bu = await client.query<{ lot_number: string | null; expiry_date: string | null }>(
        `UPDATE product_batches SET quantity_remaining = GREATEST(0, quantity_remaining - 1), updated_at = NOW()
          WHERE id = $1 RETURNING lot_number, expiry_date`,
        [s.batch_id]
      )
      lotNumber = bu.rows[0]?.lot_number ?? null
      expiryDate = bu.rows[0]?.expiry_date ?? null
    }
    await logStockMovement(client, {
      productId: item.product_id,
      variantId: item.variant_id,
      subVariantId: item.sub_variant_id,
      transactionType: 'sale',
      quantityChange: -1,
      referenceType: 'order',
      referenceId: orderId,
      batchId: s.batch_id,
      lotNumber,
      expiryDate,
      serialNumber: s.serial_number,
    })
  }
  // Tag first serial's batch for display when available.
  if (serials[0]?.batch_id) {
    await client.query(`UPDATE order_items SET batch_id = $1 WHERE id = $2`, [serials[0].batch_id, item.id])
  }
}

/** Plain product: decrement inventory_quantity by base qty + non-perishable shelf stock. */
async function deductPlain(
  client: PoolClient,
  orderId: string,
  item: OrderItemRow,
  baseQty: number,
  label: string
): Promise<void> {
  const table = item.sub_variant_id ? 'product_sub_variants' : item.variant_id ? 'product_variants' : 'products'
  const targetId = item.sub_variant_id || item.variant_id || item.product_id
  const inv = await client.query<{ inventory_quantity: string }>(
    `SELECT inventory_quantity FROM ${table} WHERE id = $1 FOR UPDATE`, [targetId]
  )
  const before = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
  if (before + 1e-6 < baseQty) {
    throw new Error(`Insufficient stock for "${label}" — available: ${before}, required: ${baseQty}`)
  }
  await client.query(
    `UPDATE ${table} SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`, [baseQty, targetId]
  )
  await logStockMovement(client, {
    productId: item.product_id,
    variantId: item.variant_id,
    subVariantId: item.sub_variant_id,
    transactionType: 'sale',
    quantityChange: -baseQty,
    referenceType: 'order',
    referenceId: orderId,
    currentStock: before,
  })
}
