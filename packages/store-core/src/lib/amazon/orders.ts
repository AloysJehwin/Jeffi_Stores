import type { PoolClient } from 'pg'
import { queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { resolveAmazonCreds } from '@/lib/integrations/resolve'
import { readSetting } from '@/lib/google-ads/notify'
import { withChannelLock, type RunResult } from '@/lib/channels/sync-run'
import { deductOrderStock, InsufficientStockError } from '@/lib/orders/inventory-deduct'
import { restoreOrderStock } from '@/lib/orders/order-stock'
import { spApiRequest } from './client'

// Amazon orders into Orders (SP-API Orders v0, polled). Each Amazon order becomes one order with
// source 'amazon' and number AMZ-<amazon id>; re-imports update it. Stock follows the existing
// order helpers, both idempotent per order: merchant-fulfilled orders deduct when Amazon confirms
// them (Unshipped/Shipped) and restore when they are cancelled after that. FBA (AFN) orders are
// recorded for sales reporting and never touch our stock. Off until the owner enables it.

export const SETTING_ORDERS = 'amazon_order_import'
const OVERLAP_MS = 2 * 60_000
const FIRST_IMPORT_DAYS = 7
const ITEMS_PAUSE_MS = 2100
const MAX_ORDERS_PER_RUN = 200
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export type AmazonOrderStatus = 'Pending' | 'Unshipped' | 'PartiallyShipped' | 'Shipped' | 'Canceled' | 'Unfulfillable' | 'InvoiceUnconfirmed' | 'PendingAvailability'

/** Our order status for an Amazon status; null keeps the current one. */
export function ourStatus(s: string): string | null {
  switch (s) {
    case 'Pending':
    case 'PendingAvailability':
      return 'pending'
    case 'Unshipped':
    case 'InvoiceUnconfirmed':
      return 'confirmed'
    case 'PartiallyShipped':
      return 'processing'
    case 'Shipped':
      return 'shipped'
    case 'Canceled':
      return 'cancelled'
    default:
      return null
  }
}

export type StockAction = 'deduct' | 'restore' | 'none'

/** What to do with our stock given the order's channel, Amazon status and what was already done. */
export function stockAction(channel: string, status: string, state: string): StockAction {
  if (channel !== 'MFN') return 'none'
  const confirmed = ['Unshipped', 'PartiallyShipped', 'Shipped', 'InvoiceUnconfirmed'].includes(status)
  if (confirmed && (state === 'none' || state === 'short')) return 'deduct'
  if (status === 'Canceled' && state === 'deducted') return 'restore'
  return 'none'
}

const amt = (m: any) => (m?.Amount == null ? null : Number(m.Amount))

export async function ordersEnabled(): Promise<boolean> {
  return (await readSetting(SETTING_ORDERS)) === 'true'
}

async function fetchOrders(since: string): Promise<any[]> {
  const creds = await resolveAmazonCreds()
  const out: any[] = []
  let nextToken: string | undefined
  do {
    const res = await spApiRequest('GET', '/orders/v0/orders', {
      query: nextToken
        ? { MarketplaceIds: creds.marketplaceId, NextToken: nextToken }
        : { MarketplaceIds: creds.marketplaceId, LastUpdatedAfter: since, MaxResultsPerPage: '100' },
    })
    out.push(...(res?.payload?.Orders ?? []))
    nextToken = res?.payload?.NextToken
    if (nextToken) await sleep(ITEMS_PAUSE_MS)
  } while (nextToken && out.length < MAX_ORDERS_PER_RUN)
  return out
}

async function fetchItems(amazonOrderId: string): Promise<any[]> {
  const out: any[] = []
  let nextToken: string | undefined
  do {
    const res = await spApiRequest('GET', `/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/orderItems`, {
      query: nextToken ? { NextToken: nextToken } : {},
    })
    out.push(...(res?.payload?.OrderItems ?? []))
    nextToken = res?.payload?.NextToken
  } while (nextToken)
  return out
}

interface SkuMatch {
  product_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  hsn_code: string | null
  gst_rate: string | null
}

async function matchSkus(db: PoolClient, skus: string[]): Promise<Map<string, SkuMatch>> {
  if (!skus.length) return new Map()
  const rows = await db.query<SkuMatch & { sku: string }>(
    `SELECT v.sku, p.id AS product_id, v.id AS variant_id, p.name, v.variant_name, p.hsn_code, p.gst_percentage::text AS gst_rate
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ANY($1::text[])
     UNION ALL
     SELECT p.sku, p.id, NULL, p.name, NULL, p.hsn_code, p.gst_percentage::text FROM products p WHERE p.sku = ANY($1::text[])`,
    [skus]
  )
  const map = new Map<string, SkuMatch>()
  for (const r of rows.rows) if (!map.has(r.sku)) map.set(r.sku, r)
  return map
}

export interface ImportOutcome {
  amazonOrderId: string
  orderId: string
  created: boolean
  stock: StockAction
  stockState: string
}

/** Upserts one Amazon order (and its items) as our order, then applies the stock action. */
export async function upsertAmazonOrder(o: any, items: any[]): Promise<ImportOutcome> {
  const id = String(o.AmazonOrderId)
  const status = String(o.OrderStatus)
  const channel = String(o.FulfillmentChannel ?? 'MFN')
  const outcome = await withTransaction(async db => {
    const existing = await db.query<{ order_id: string | null; stock_state: string }>(
      `SELECT order_id, stock_state FROM amazon_orders WHERE amazon_order_id = $1 FOR UPDATE`,
      [id]
    )
    const prior = existing.rows[0]
    const matches = await matchSkus(db, items.map(i => String(i.SellerSKU ?? '')).filter(Boolean))
    const lines = items.map(i => {
      const qty = Number(i.QuantityOrdered ?? 0)
      const price = amt(i.ItemPrice) ?? 0
      const tax = amt(i.ItemTax) ?? 0
      return { i, qty, price, tax, m: matches.get(String(i.SellerSKU ?? '')) ?? null }
    })
    const itemsTotal = lines.reduce((s, l) => s + l.price, 0)
    const taxTotal = lines.reduce((s, l) => s + l.tax, 0)
    const total = amt(o.OrderTotal) ?? itemsTotal
    const addr = o.ShippingAddress ?? {}
    const next = ourStatus(status)
    const ts = (v: unknown) => (v ? new Date(String(v)).toISOString() : null)

    let orderId = prior?.order_id ?? null
    const created = !orderId
    if (!orderId) {
      const ins = await db.query<{ id: string }>(
        `INSERT INTO orders (order_number, customer_name, status, payment_status, payment_mode, subtotal, tax_amount, total_amount,
           source, needs_delivery, shipping_address_snapshot, admin_notes, created_at, confirmed_at)
         VALUES ($1, 'Amazon customer', $2, $3, 'marketplace', $4, $5, $6, 'amazon', false, $7::jsonb, $8, COALESCE($9::timestamptz, now()), $10)
         RETURNING id`,
        [
          `AMZ-${id}`,
          next ?? 'pending',
          status === 'Pending' || status === 'PendingAvailability' ? 'pending' : status === 'Canceled' ? 'cancelled' : 'paid',
          Math.round((itemsTotal - taxTotal) * 100) / 100,
          taxTotal,
          total,
          JSON.stringify({ city: addr.City ?? null, state: addr.StateOrRegion ?? null, postal_code: addr.PostalCode ?? null, country: addr.CountryCode ?? 'IN' }),
          `Amazon order ${id} (${channel === 'AFN' ? 'fulfilled by Amazon' : 'fulfilled by you'})`,
          ts(o.PurchaseDate),
          next === 'confirmed' ? ts(o.LastUpdateDate) : null,
        ]
      )
      orderId = ins.rows[0].id
      for (const l of lines) {
        if (!l.m) continue
        await db.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, product_sku, variant_name, quantity, unit_price, tax_amount, total_price, hsn_code, gst_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::numeric)`,
          [orderId, l.m.product_id, l.m.variant_id, l.m.name, l.i.SellerSKU, l.m.variant_name, l.qty, l.qty ? Math.round((l.price / l.qty) * 100) / 100 : 0, l.tax, l.price, l.m.hsn_code, l.m.gst_rate]
        )
      }
    } else if (next) {
      await db.query(
        `UPDATE orders SET status = $2,
           payment_status = CASE WHEN $2 = 'cancelled' THEN payment_status WHEN $2 = 'pending' THEN payment_status ELSE 'paid' END,
           confirmed_at = CASE WHEN $2 IN ('confirmed', 'processing', 'shipped') THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END,
           shipped_at = CASE WHEN $2 = 'shipped' THEN COALESCE(shipped_at, now()) ELSE shipped_at END,
           cancelled_at = CASE WHEN $2 = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
           total_amount = $3
         WHERE id = $1`,
        [orderId, next, total]
      )
    }

    await db.query(
      `INSERT INTO amazon_orders (amazon_order_id, order_id, status, fulfillment_channel, purchase_date, last_update_date, order_total, currency,
         ship_city, ship_state, ship_postal_code, is_prime, easy_ship, raw, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
       ON CONFLICT (amazon_order_id) DO UPDATE SET order_id = EXCLUDED.order_id, status = EXCLUDED.status, last_update_date = EXCLUDED.last_update_date,
         order_total = EXCLUDED.order_total, raw = EXCLUDED.raw, updated_at = now()`,
      [
        id,
        orderId,
        status,
        channel,
        ts(o.PurchaseDate),
        ts(o.LastUpdateDate),
        total,
        o.OrderTotal?.CurrencyCode ?? 'INR',
        addr.City ?? null,
        addr.StateOrRegion ?? null,
        addr.PostalCode ?? null,
        !!o.IsPrime,
        !!o.EasyShipShipmentStatus,
        JSON.stringify(o),
      ]
    )
    for (const l of lines) {
      await db.query(
        `INSERT INTO amazon_order_items (order_item_id, amazon_order_id, sku, asin, title, quantity, quantity_shipped, item_price, item_tax, product_id, variant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (order_item_id) DO UPDATE SET quantity = EXCLUDED.quantity, quantity_shipped = EXCLUDED.quantity_shipped,
           item_price = EXCLUDED.item_price, item_tax = EXCLUDED.item_tax, product_id = EXCLUDED.product_id, variant_id = EXCLUDED.variant_id`,
        [String(l.i.OrderItemId), id, l.i.SellerSKU ?? null, l.i.ASIN ?? null, l.i.Title ?? null, l.qty, Number(l.i.QuantityShipped ?? 0), l.price, l.tax, l.m?.product_id ?? null, l.m?.variant_id ?? null]
      )
    }
    const unmatched = channel === 'MFN' && lines.some(l => !l.m)
    return { orderId: orderId!, created, state: prior?.stock_state ?? 'none', unmatched }
  })

  let stockState = outcome.state
  const action = stockAction(channel, status, stockState)
  let note: string | null = null
  if (action === 'deduct') {
    try {
      await deductOrderStock(outcome.orderId)
      stockState = 'deducted'
    } catch (e) {
      if (!(e instanceof InsufficientStockError)) throw e
      stockState = 'short'
      note = e.message.slice(0, 500)
    }
  } else if (action === 'restore') {
    await restoreOrderStock(outcome.orderId)
    stockState = 'restored'
  }
  if (outcome.unmatched && stockState === 'deducted') note = 'Some lines had no matching SKU in your catalogue and did not move stock.'
  if (outcome.unmatched && stockState === 'none') stockState = 'unmatched'
  if (stockState !== outcome.state || note) {
    await queryOne(`UPDATE amazon_orders SET stock_state = $2, stock_note = COALESCE($3, stock_note) WHERE amazon_order_id = $1 RETURNING 1`, [id, stockState, note])
  }
  return { amazonOrderId: id, orderId: outcome.orderId, created: outcome.created, stock: action, stockState }
}

/** Import orders updated since the last run (first run: the last 7 days). */
export async function importAmazonOrders(now = new Date()): Promise<RunResult> {
  return withChannelLock('amazon', 'amazon_orders', 'orders', async ({ step }) => {
    const last = await queryOne<{ max: string | null }>(`SELECT max(last_update_date) AS max FROM amazon_orders`)
    const since = new Date(last?.max ? new Date(last.max).getTime() - OVERLAP_MS : now.getTime() - FIRST_IMPORT_DAYS * 86_400_000)
    // Amazon rejects LastUpdatedAfter within 2 minutes of now.
    const capped = new Date(Math.min(since.getTime(), now.getTime() - 3 * 60_000)).toISOString()
    let orders: any[] = []
    await step('fetched', async () => {
      orders = await fetchOrders(capped)
      return orders.length
    })
    for (const o of orders) {
      await step('orders', async () => {
        const items = await fetchItems(String(o.AmazonOrderId))
        await sleep(ITEMS_PAUSE_MS)
        const r = await upsertAmazonOrder(o, items)
        return r.created ? 1 : 0
      })
    }
  })
}

export async function loadAmazonOrders(limit = 300) {
  const [rows, summary] = await Promise.all([
    queryMany<any>(
      `SELECT a.amazon_order_id, a.order_id, o.order_number, a.status, a.fulfillment_channel, a.purchase_date, a.order_total, a.ship_city, a.ship_state,
              a.stock_state, a.stock_note, a.is_prime,
              (SELECT json_agg(json_build_object('sku', i.sku, 'title', i.title, 'qty', i.quantity, 'matched', i.product_id IS NOT NULL)) FROM amazon_order_items i WHERE i.amazon_order_id = a.amazon_order_id) AS items
       FROM amazon_orders a LEFT JOIN orders o ON o.id = a.order_id ORDER BY a.purchase_date DESC NULLS LAST LIMIT $1`,
      [limit]
    ),
    queryOne<any>(
      `SELECT count(*) FILTER (WHERE purchase_date > now() - interval '30 days') AS orders_30d,
              COALESCE(sum(order_total) FILTER (WHERE purchase_date > now() - interval '30 days' AND status <> 'Canceled'), 0) AS revenue_30d,
              count(*) FILTER (WHERE stock_state IN ('short', 'unmatched')) AS needs_attention
       FROM amazon_orders`
    ),
  ])
  return { rows, summary, enabled: await ordersEnabled() }
}
