import { createHash } from 'crypto'
import type { PoolClient } from 'pg'
import { withTransaction } from '@/lib/shared/db'
import { deductOrderStock, InsufficientStockError } from '@/lib/orders/inventory-deduct'
import { restoreOrderStock } from '@/lib/orders/order-stock'
import { matchSkus, type SkuMatch } from './match'
import { decideTransition, ourOrderStatus, paymentStatusFor, stockAction } from './order-state'
import { CHANNEL_LABEL, ORDER_PREFIX, STATUS_RANK, type MarketplaceChannel, type MarketStatus, type NormalizedLine, type NormalizedOrder, type StockAction, type StockState } from './types'

// One marketplace order into Orders. Each becomes one order (source = channel, payment_mode
// 'marketplace', needs_delivery false, number MYN-/AJI-<marketplace id>); later events update it.
// Everything, stock included, happens in one transaction under an advisory lock on the order, so a
// replayed or concurrent event can't create a second order or move stock twice. Tracking goes to
// marketplace_shipments, never orders.awb_number (that column means a Delhivery shipment).

export interface UpsertOutcome {
  marketplaceOrderId: string
  orderId: string
  orderNumber: string
  created: boolean
  /** False when the event was stale and nothing changed. */
  applied: boolean
  status: MarketStatus
  stock: StockAction
  stockState: StockState
}

const r2 = (n: number) => Math.round(n * 100) / 100
const iso = (v?: string | null) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Our order number for a marketplace order (orders.order_number is varchar(50)). */
export function orderNumberFor(channel: MarketplaceChannel, externalOrderId: string): string {
  const prefix = `${ORDER_PREFIX[channel]}-`
  const id = externalOrderId.trim()
  if (prefix.length + id.length <= 50) return prefix + id
  return `${prefix}${id.slice(0, 50 - prefix.length - 9)}-${createHash('sha1').update(id).digest('hex').slice(0, 8)}`
}

/** Order timestamps a status sets (null = leave as is). */
function stamps(s: MarketStatus, at: string) {
  const rank = STATUS_RANK[s]
  const live = s !== 'cancelled' && s !== 'rejected'
  return {
    confirmed: live && rank >= STATUS_RANK.accepted ? at : null,
    shipped: live && rank >= STATUS_RANK.shipped && s !== 'returned' ? at : null,
    delivered: s === 'delivered' ? at : null,
    cancelled: live ? null : at,
  }
}

type Db = PoolClient

async function insertOrderItems(db: Db, orderId: string, lines: NormalizedLine[], matches: Map<string, SkuMatch>): Promise<number> {
  let n = 0
  for (const l of lines) {
    const m = matches.get(l.sku.trim())
    if (!m) continue
    const qty = l.quantity
    await db.query(
      `INSERT INTO order_items (order_id, product_id, variant_id, sub_variant_id, product_name, product_sku, variant_name, sub_variant_name,
         quantity, unit_price, tax_amount, total_price, hsn_code, gst_rate, mrp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::numeric,$15)`,
      [orderId, m.product_id, m.variant_id, m.sub_variant_id, m.name, l.sku, m.variant_name, m.sub_variant_name, qty, r2(l.unitPrice), r2((l.unitTax ?? 0) * qty), r2(l.unitPrice * qty), m.hsn_code, m.gst_rate, l.mrp ?? null]
    )
    n++
  }
  return n
}

async function upsertUnits(db: Db, marketplaceOrderId: string, o: NormalizedOrder, status: MarketStatus, matches: Map<string, SkuMatch>) {
  const rows = o.lines.flatMap(l => {
    const m = matches.get(l.sku.trim())
    return Array.from({ length: l.quantity }, (_, i) => ({
      line_id: l.lineId,
      unit_index: i + 1,
      sku: l.sku,
      style_id: l.styleId ?? null,
      title: l.title ?? null,
      size: l.size ?? null,
      colour: l.colour ?? null,
      unit_price: l.unitPrice,
      unit_tax: l.unitTax ?? null,
      mrp: l.mrp ?? null,
      status: l.status ?? status,
      product_id: m?.product_id ?? null,
      variant_id: m?.variant_id ?? null,
      sub_variant_id: m?.sub_variant_id ?? null,
      matched_by: m?.matched_by ?? null,
    }))
  })
  if (!rows.length) return
  await db.query(
    `INSERT INTO marketplace_order_items (marketplace_order_id, channel, external_line_id, unit_index, sku, style_id, title, size, colour,
       unit_price, unit_tax, mrp, status, product_id, variant_id, sub_variant_id, matched_by)
     SELECT $1, $2, r.line_id, r.unit_index, r.sku, r.style_id, r.title, r.size, r.colour, r.unit_price, r.unit_tax, r.mrp, r.status,
            r.product_id, r.variant_id, r.sub_variant_id, r.matched_by
       FROM jsonb_to_recordset($3::jsonb) AS r(line_id text, unit_index smallint, sku text, style_id text, title text, size text, colour text,
            unit_price numeric, unit_tax numeric, mrp numeric, status text, product_id uuid, variant_id uuid, sub_variant_id uuid, matched_by text)
     ON CONFLICT (marketplace_order_id, external_line_id, unit_index) DO UPDATE SET
       status = EXCLUDED.status,
       product_id = COALESCE(marketplace_order_items.product_id, EXCLUDED.product_id),
       variant_id = COALESCE(marketplace_order_items.variant_id, EXCLUDED.variant_id),
       sub_variant_id = COALESCE(marketplace_order_items.sub_variant_id, EXCLUDED.sub_variant_id),
       matched_by = COALESCE(marketplace_order_items.matched_by, EXCLUDED.matched_by),
       updated_at = now()`,
    [marketplaceOrderId, o.channel, JSON.stringify(rows)]
  )
}

async function upsertShipment(db: Db, marketplaceOrderId: string, orderId: string, o: NormalizedOrder, status: MarketStatus) {
  const s = o.shipment
  if (!s || !(s.packetId || s.trackingNumber || s.manifestId)) return
  const at = iso(o.eventAt) ?? new Date().toISOString()
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM marketplace_shipments WHERE marketplace_order_id = $1 AND ($2::text IS NULL OR packet_id IS NULL OR packet_id = $2)
      ORDER BY (packet_id IS NOT DISTINCT FROM $2) DESC LIMIT 1`,
    [marketplaceOrderId, s.packetId ?? null]
  )
  const vals = [s.packetId ?? null, s.trackingNumber ?? null, s.courier ?? null, s.trackingUrl ?? null, s.manifestId ?? null, status, s.lineIds ?? [], status === 'shipped' ? at : null, status === 'delivered' ? at : null]
  if (existing.rows[0]) {
    await db.query(
      `UPDATE marketplace_shipments SET packet_id = COALESCE($2, packet_id), tracking_number = COALESCE($3, tracking_number), courier = COALESCE($4, courier),
         tracking_url = COALESCE($5, tracking_url), manifest_id = COALESCE($6, manifest_id), status = $7,
         line_ids = CASE WHEN cardinality($8::text[]) > 0 THEN $8::text[] ELSE line_ids END,
         dispatched_at = COALESCE(dispatched_at, $9::timestamptz), delivered_at = COALESCE(delivered_at, $10::timestamptz), updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id, ...vals]
    )
  } else {
    await db.query(
      `INSERT INTO marketplace_shipments (marketplace_order_id, order_id, channel, packet_id, tracking_number, courier, tracking_url, manifest_id, status, line_ids, dispatched_at, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12)`,
      [marketplaceOrderId, orderId, o.channel, ...vals]
    )
  }
}

async function upsertInTx(db: Db, o: NormalizedOrder): Promise<UpsertOutcome> {
  const channel = o.channel
  const ext = o.externalOrderId.trim()
  const orderNumber = orderNumberFor(channel, ext)
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`marketplace_order:${channel}:${ext}`])
  const prior = (
    await db.query<{ id: string; order_id: string | null; status: MarketStatus; event_at: string | Date | null; stock_state: StockState }>(
      `SELECT id, order_id, status, event_at, stock_state FROM marketplace_orders WHERE channel = $1 AND external_order_id = $2 FOR UPDATE`,
      [channel, ext]
    )
  ).rows[0]
  const t = decideTransition(prior ? { status: prior.status, eventAt: prior.event_at ? new Date(prior.event_at).toISOString() : null } : null, {
    status: o.status,
    eventAt: o.eventAt,
  })
  if (prior && !t.apply) {
    return { marketplaceOrderId: prior.id, orderId: prior.order_id ?? '', orderNumber, created: false, applied: false, status: prior.status, stock: 'none', stockState: prior.stock_state }
  }

  const matches = await matchSkus(db, channel, o.lines.map(l => l.sku))
  const itemsTotal = o.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const taxTotal = o.lines.reduce((s, l) => s + (l.unitTax ?? 0) * l.quantity, 0)
  const total = o.total ?? (o.lines.length ? itemsTotal : null)
  const at = iso(o.eventAt) ?? new Date().toISOString()
  const st = stamps(t.status, at)
  const label = CHANNEL_LABEL[channel]

  let orderId = prior?.order_id ?? null
  let created = false
  if (!orderId) {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO orders (order_number, customer_name, status, payment_status, payment_mode, subtotal, tax_amount, total_amount,
         source, needs_delivery, shipping_address_snapshot, admin_notes, created_at, confirmed_at, shipped_at, delivered_at, cancelled_at)
       VALUES ($1, $2, $3, $4, 'marketplace', $5, $6, $7, $8, false, $9::jsonb, $10, COALESCE($11::timestamptz, now()), $12, $13, $14, $15)
       RETURNING id`,
      [
        orderNumber,
        `${label} customer`,
        ourOrderStatus(t.status),
        paymentStatusFor(t.status),
        r2((total ?? 0) - taxTotal),
        r2(taxTotal),
        r2(total ?? 0),
        channel,
        JSON.stringify({ city: o.shipping?.city ?? null, state: o.shipping?.state ?? null, postal_code: o.shipping?.postalCode ?? null, country: o.shipping?.country ?? 'IN' }),
        `${label} order ${ext}`,
        iso(o.placedAt),
        st.confirmed,
        st.shipped,
        st.delivered,
        st.cancelled,
      ]
    )
    orderId = ins.rows[0].id
    created = true
    await insertOrderItems(db, orderId, o.lines, matches)
  } else {
    if (t.changed) {
      const keepPayment = t.status === 'cancelled' || t.status === 'rejected' || t.status === 'returned'
      await db.query(
        `UPDATE orders SET status = $2, payment_status = COALESCE($3, payment_status),
           confirmed_at = COALESCE(confirmed_at, $4::timestamptz), shipped_at = COALESCE(shipped_at, $5::timestamptz),
           delivered_at = COALESCE(delivered_at, $6::timestamptz), cancelled_at = COALESCE(cancelled_at, $7::timestamptz),
           total_amount = COALESCE($8, total_amount), updated_at = now()
         WHERE id = $1`,
        [orderId, ourOrderStatus(t.status), keepPayment ? null : paymentStatusFor(t.status), st.confirmed, st.shipped, st.delivered, st.cancelled, total == null ? null : r2(total)]
      )
    }
    if (o.lines.length) {
      const has = await db.query(`SELECT 1 FROM order_items WHERE order_id = $1 LIMIT 1`, [orderId])
      if (!has.rows.length) await insertOrderItems(db, orderId, o.lines, matches)
    }
  }

  const mo = await db.query<{ id: string }>(
    `INSERT INTO marketplace_orders (channel, external_order_id, order_id, status, raw_status, status_rank, event_at, placed_at, accept_by, dispatch_by,
       order_total, currency, ship_city, ship_state, ship_postal_code, invoice_ref, po_number, po_date, po_amount, raw, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,now())
     ON CONFLICT (channel, external_order_id) DO UPDATE SET
       order_id = EXCLUDED.order_id, status = EXCLUDED.status, raw_status = EXCLUDED.raw_status, status_rank = EXCLUDED.status_rank,
       event_at = COALESCE(EXCLUDED.event_at, marketplace_orders.event_at),
       placed_at = COALESCE(marketplace_orders.placed_at, EXCLUDED.placed_at),
       accept_by = COALESCE(EXCLUDED.accept_by, marketplace_orders.accept_by),
       dispatch_by = COALESCE(EXCLUDED.dispatch_by, marketplace_orders.dispatch_by),
       order_total = COALESCE(EXCLUDED.order_total, marketplace_orders.order_total),
       ship_city = COALESCE(EXCLUDED.ship_city, marketplace_orders.ship_city),
       ship_state = COALESCE(EXCLUDED.ship_state, marketplace_orders.ship_state),
       ship_postal_code = COALESCE(EXCLUDED.ship_postal_code, marketplace_orders.ship_postal_code),
       invoice_ref = COALESCE(EXCLUDED.invoice_ref, marketplace_orders.invoice_ref),
       po_number = COALESCE(EXCLUDED.po_number, marketplace_orders.po_number),
       po_date = COALESCE(EXCLUDED.po_date, marketplace_orders.po_date),
       po_amount = COALESCE(EXCLUDED.po_amount, marketplace_orders.po_amount),
       raw = EXCLUDED.raw, updated_at = now()
     RETURNING id`,
    [
      channel,
      ext,
      orderId,
      t.status,
      o.rawStatus ?? null,
      STATUS_RANK[t.status],
      iso(o.eventAt),
      iso(o.placedAt),
      iso(o.acceptBy),
      iso(o.dispatchBy),
      total == null ? null : r2(total),
      o.currency || 'INR',
      o.shipping?.city ?? null,
      o.shipping?.state ?? null,
      o.shipping?.postalCode ?? null,
      o.invoiceRef ?? null,
      o.po?.number ?? null,
      iso(o.po?.date),
      o.po?.amount ?? null,
      JSON.stringify(o.raw ?? {}),
    ]
  )
  const marketplaceOrderId = mo.rows[0].id
  await upsertUnits(db, marketplaceOrderId, o, t.status, matches)
  await upsertShipment(db, marketplaceOrderId, orderId, o, t.status)

  const priorState: StockState = prior?.stock_state ?? 'none'
  let stockState = priorState
  let action = stockAction(t.status, priorState)
  let note: string | null = null
  if (action === 'deduct') {
    const has = await db.query(`SELECT 1 FROM order_items WHERE order_id = $1 LIMIT 1`, [orderId])
    if (!has.rows.length) {
      action = 'none'
      stockState = 'unmatched'
      note = 'No line matched a SKU in your catalogue, so stock did not move.'
    } else {
      await db.query('SAVEPOINT marketplace_stock')
      try {
        await deductOrderStock(orderId, {}, db)
        await db.query('RELEASE SAVEPOINT marketplace_stock')
        stockState = 'deducted'
        const loose = await db.query(`SELECT 1 FROM marketplace_order_items WHERE marketplace_order_id = $1 AND product_id IS NULL LIMIT 1`, [marketplaceOrderId])
        if (loose.rows.length) note = 'Some lines had no matching SKU in your catalogue and did not move stock.'
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT marketplace_stock')
        if (!(e instanceof InsufficientStockError)) throw e
        stockState = 'short'
        note = e.message.slice(0, 500)
      }
    }
  } else if (action === 'restore') {
    await restoreOrderStock(orderId, db)
    stockState = 'restored'
  }
  if (stockState !== priorState || note) {
    await db.query(`UPDATE marketplace_orders SET stock_state = $2, stock_note = COALESCE($3, stock_note) WHERE id = $1`, [marketplaceOrderId, stockState, note])
  }
  return { marketplaceOrderId, orderId, orderNumber, created, applied: true, status: t.status, stock: action, stockState }
}

/** Creates or updates the order for a normalised marketplace event, moving stock with it. */
export async function upsertMarketplaceOrder(o: NormalizedOrder): Promise<UpsertOutcome> {
  if (!o.externalOrderId?.trim()) throw new Error('Marketplace order without an id')
  const lines = (o.lines ?? [])
    .filter(l => l && String(l.lineId ?? '').trim() && String(l.sku ?? '').trim())
    .map(l => ({ ...l, lineId: String(l.lineId).trim(), quantity: Math.min(1000, Math.max(1, Math.floor(Number(l.quantity) || 1))), unitPrice: Number(l.unitPrice) || 0 }))
  return withTransaction(db => upsertInTx(db, { ...o, lines }))
}
