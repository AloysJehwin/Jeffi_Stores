import { query, queryMany } from '@/lib/shared/db'
import { readSetting, writeSettings } from '@/lib/google-ads/notify'
import { ChannelJobBusyError, errorText, lastRuns, withChannelLock, type RunResult, type SyncLogRow } from '@/lib/channels/sync-run'
import { IntegrationNotConnectedError, MARKETPLACE_PROVIDER, resolveMarketplaceCreds, type MarketplaceCreds } from '@/lib/integrations/resolve'
import { getCurrentTenant, getCurrentTenantId, runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { AdapterUnavailableError, type InventoryResult, type MarketplaceAdapter } from './adapter'
import { resolveEndpoints } from './endpoints'
import { chunk } from './listings'
import { getAdapter } from './registry'
import { MARKETPLACE_CHANNELS, type MarketplaceChannel } from './types'

// Stock to Myntra and AJIO. Our catalogue is the source of truth: the marketplace gets the unit's
// quantity minus units held by marketplace orders not yet accepted, minus a safety buffer, never
// below zero (0 for inactive or out-of-stock units). Only rows whose number changed (or whose last
// push failed) are sent, in the endpoint config's batch size, paced to its rate limit. Runs from
// the sync cron, "Push now", and after every order event that moved stock.

export const MAX_PUSHES_PER_RUN = 3000
const settingKey = (channel: MarketplaceChannel) => `${channel}_stock_buffer`

export function desiredQuantity(available: number | null, reserved: number, buffer: number, sellable = true): number {
  if (!sellable || available == null || !Number.isFinite(available)) return 0
  return Math.max(0, Math.floor(available) - reserved - buffer)
}

export async function stockSettings(channel: MarketplaceChannel): Promise<{ buffer: number }> {
  return { buffer: Math.max(0, Math.min(1000, Math.round(Number((await readSetting(settingKey(channel))) ?? 0)) || 0)) }
}

export async function saveStockBuffer(channel: MarketplaceChannel, buffer: number): Promise<void> {
  await writeSettings({ [settingKey(channel)]: String(Math.max(0, Math.min(1000, Math.round(buffer) || 0))) })
}

/** Myntra takes stock per warehouse; with several IDs saved, the first one carries the stock. */
export function primaryWarehouse(creds: Pick<MarketplaceCreds, 'fields'> | null): string {
  return (creds?.fields?.warehouse_ids ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''
}

export interface MarketStockRow {
  listing_id: string
  sku: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  title: string
  listing_status: string
  available: string | number | null
  reserved: string | number
  sellable: boolean
  our_price: string | number | null
  listed_price: string | number | null
  pushed_qty: number | null
  pushed_at: string | null
  push_error: string | null
}

/** Mapped listings with our quantity, reserved units and what was last pushed to the warehouse. */
export async function marketStockRows(channel: MarketplaceChannel, warehouseId: string): Promise<MarketStockRow[]> {
  return queryMany<MarketStockRow>(
    `WITH reserved AS (
       SELECT i.product_id, i.variant_id, i.sub_variant_id, count(*) AS units
         FROM marketplace_order_items i JOIN marketplace_orders o ON o.id = i.marketplace_order_id
        WHERE o.status = 'created' AND o.stock_state = 'none' AND i.product_id IS NOT NULL
        GROUP BY 1, 2, 3
     )
     SELECT l.id AS listing_id, l.marketplace_sku AS sku, l.product_id, l.variant_id, l.sub_variant_id, l.status AS listing_status,
            concat_ws(' · ', p.name, v.variant_name, sv.sub_variant_name) AS title,
            CASE WHEN l.sub_variant_id IS NOT NULL THEN sv.inventory_quantity WHEN l.variant_id IS NOT NULL THEN v.inventory_quantity ELSE p.inventory_quantity END AS available,
            COALESCE(r.units, 0) AS reserved,
            (COALESCE(p.is_active, true) AND COALESCE(v.is_active, true) AND COALESCE(sv.is_active, true)
              AND COALESCE(CASE WHEN l.sub_variant_id IS NOT NULL THEN sv.stock_status WHEN l.variant_id IS NOT NULL THEN v.stock_status ELSE p.stock_status END, '') <> 'Out of Stock') AS sellable,
            COALESCE(sv.price, v.price, p.base_price) AS our_price, l.listed_price,
            s.pushed_qty, s.pushed_at, s.push_error
       FROM marketplace_listings l
       JOIN products p ON p.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
       LEFT JOIN product_sub_variants sv ON sv.id = l.sub_variant_id
       LEFT JOIN reserved r ON r.product_id = l.product_id AND r.variant_id IS NOT DISTINCT FROM l.variant_id AND r.sub_variant_id IS NOT DISTINCT FROM l.sub_variant_id
       LEFT JOIN marketplace_inventory_state s ON s.channel = l.channel AND s.marketplace_sku = l.marketplace_sku AND s.warehouse_id = $2
      WHERE l.channel = $1 AND l.marketplace_sku IS NOT NULL AND l.status IN ('mapped', 'submitted', 'live')
      ORDER BY title`,
    [channel, warehouseId]
  )
}

export interface PlannedRow {
  row: MarketStockRow
  qty: number
  changed: boolean
}

/** What each row should show on the marketplace, and which rows need sending. */
export function planPush(rows: MarketStockRow[], buffer: number): PlannedRow[] {
  return rows.map(row => {
    const qty = desiredQuantity(row.available == null ? null : Number(row.available), Number(row.reserved) || 0, buffer, row.sellable !== false)
    return { row, qty, changed: row.pushed_qty !== qty || !!row.push_error }
  })
}

async function recordAvailable(channel: MarketplaceChannel, warehouseId: string, plan: PlannedRow[]): Promise<void> {
  if (!plan.length) return
  await query(
    `INSERT INTO marketplace_inventory_state (channel, marketplace_sku, warehouse_id, listing_id, product_id, variant_id, sub_variant_id, our_available, reserved, updated_at)
     SELECT $1, r.sku, $2, r.listing_id, r.product_id, r.variant_id, r.sub_variant_id, r.available, r.reserved, now()
       FROM jsonb_to_recordset($3::jsonb) AS r(sku text, listing_id uuid, product_id uuid, variant_id uuid, sub_variant_id uuid, available numeric, reserved int)
     ON CONFLICT (channel, marketplace_sku, warehouse_id) DO UPDATE SET listing_id = EXCLUDED.listing_id, product_id = EXCLUDED.product_id,
       variant_id = EXCLUDED.variant_id, sub_variant_id = EXCLUDED.sub_variant_id, our_available = EXCLUDED.our_available,
       reserved = EXCLUDED.reserved, updated_at = now()`,
    [
      channel,
      warehouseId,
      JSON.stringify(
        plan.map(p => ({
          sku: p.row.sku,
          listing_id: p.row.listing_id,
          product_id: p.row.product_id,
          variant_id: p.row.variant_id,
          sub_variant_id: p.row.sub_variant_id,
          available: p.row.available == null ? null : Number(p.row.available),
          reserved: Number(p.row.reserved) || 0,
        }))
      ),
    ]
  )
}

/** Per-SKU outcome of a batch. An empty answer means the marketplace took the whole batch. */
export function batchOutcome(batch: PlannedRow[], results: InventoryResult[]): { sku: string; qty: number; error: string | null }[] {
  const bySku = new Map(results.map(r => [r.sku, r]))
  return batch.map(b => {
    const r = bySku.get(b.row.sku)
    const error = !results.length || r?.ok ? null : r ? r.error || 'Refused by the marketplace' : 'No answer for this SKU'
    return { sku: b.row.sku, qty: b.qty, error }
  })
}

async function saveOutcome(channel: MarketplaceChannel, warehouseId: string, rows: { sku: string; qty: number; error: string | null }[]): Promise<void> {
  await query(
    `UPDATE marketplace_inventory_state s SET
       pushed_qty = CASE WHEN r.error IS NULL THEN r.qty ELSE s.pushed_qty END,
       pushed_at = CASE WHEN r.error IS NULL THEN now() ELSE s.pushed_at END,
       push_error = r.error, updated_at = now()
       FROM jsonb_to_recordset($3::jsonb) AS r(sku text, qty int, error text)
      WHERE s.channel = $1 AND s.warehouse_id = $2 AND s.marketplace_sku = r.sku`,
    [channel, warehouseId, JSON.stringify(rows)]
  )
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface PushOptions {
  /** Skip the run (and its log row) when no row changed; for order-event pushes. */
  onlyIfChanged?: boolean
  adapter?: MarketplaceAdapter
  wait?: (ms: number) => Promise<unknown>
}

/** Pushes changed rows under the channel's stock lock. Null when onlyIfChanged found nothing to send. */
export async function pushMarketplaceStock(channel: MarketplaceChannel, opts: PushOptions = {}): Promise<RunResult | null> {
  const creds = await resolveMarketplaceCreds(channel)
  if (!creds) throw new IntegrationNotConnectedError(MARKETPLACE_PROVIDER[channel], getCurrentTenantId() ?? 'platform')
  const warehouse = primaryWarehouse(creds)
  const { buffer } = await stockSettings(channel)
  if (opts.onlyIfChanged && !planPush(await marketStockRows(channel, warehouse), buffer).some(p => p.changed)) return null
  const adapter = opts.adapter ?? getAdapter(channel, creds)
  const ep = resolveEndpoints(channel, creds)
  const wait = opts.wait ?? sleep
  const gapMs = Math.ceil(1000 / Math.max(0.1, ep.rateLimit.perSecond))
  return withChannelLock(channel, channel === 'myntra' ? 'myntra_stock' : 'ajio_stock', 'stock', async ({ step, counts, errors }) => {
    const plan = planPush(await marketStockRows(channel, warehouse), buffer)
    await recordAvailable(channel, warehouse, plan)
    const changed = plan.filter(p => p.changed)
    counts.changed = changed.length
    if (changed.length > MAX_PUSHES_PER_RUN) counts.deferred = changed.length - MAX_PUSHES_PER_RUN
    const batches = chunk(changed.slice(0, MAX_PUSHES_PER_RUN), ep.batch.inventory)
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      if (i) await wait(gapMs)
      let stop = false
      await step('pushed', async () => {
        let results: InventoryResult[]
        try {
          results = await adapter.pushInventory(batch.map(b => ({ sku: b.row.sku, quantity: b.qty, warehouseId: warehouse || null })))
        } catch (e) {
          await saveOutcome(channel, warehouse, batch.map(b => ({ sku: b.row.sku, qty: b.qty, error: errorText(e) })))
          stop = e instanceof AdapterUnavailableError
          throw e
        }
        const outcome = batchOutcome(batch, results)
        await saveOutcome(channel, warehouse, outcome)
        const failed = outcome.filter(o => o.error)
        if (failed.length) {
          counts.failed = (counts.failed ?? 0) + failed.length
          errors.push({ step: 'pushed', message: `${failed[0].sku}: ${failed[0].error}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}` })
        }
        return outcome.length - failed.length
      })
      if (stop) break
    }
  })
}

// After an order event: push every connected channel (stock is shared), one run at a time per
// store and channel; a request that lands mid-run makes it run once more.
const inflight = new Map<string, { again: boolean }>()

function schedule(channel: MarketplaceChannel): void {
  const tenant = getCurrentTenant()
  const key = `${tenant?.tenantId ?? 'platform'}:${channel}`
  const cur = inflight.get(key)
  if (cur) {
    cur.again = true
    return
  }
  const state = { again: false }
  inflight.set(key, state)
  const run = async () => {
    let retried = false
    try {
      do {
        state.again = false
        if (!(await resolveMarketplaceCreds(channel).catch(() => null))) break
        try {
          await pushMarketplaceStock(channel, { onlyIfChanged: true })
        } catch (e) {
          // The cron or "Push now" holds the lock; try once more when it is likely done.
          if (!(e instanceof ChannelJobBusyError) || retried) break
          retried = true
          await sleep(30_000)
          state.again = true
        }
      } while (state.again)
    } finally {
      inflight.delete(key)
    }
  }
  void (tenant ? runWithTenantContext(tenant, run) : run()).catch(e => console.error(`[${channel}] stock push after order failed`, e))
}

export function pushStockAfterOrderEvent(): void {
  for (const c of MARKETPLACE_CHANNELS) schedule(c)
}

export interface InventoryRow {
  sku: string
  title: string
  listingStatus: string
  available: number | null
  reserved: number
  desired: number
  pushedQty: number | null
  pushedAt: string | null
  pushError: string | null
  ourPrice: number | null
  listedPrice: number | null
}

export interface InventoryView {
  buffer: number
  warehouse: string
  rows: InventoryRow[]
  totals: { rows: number; pending: number; errors: number; drift: number; neverPushed: number }
  lastRun: SyncLogRow | null
  lastPushAt: string | null
}

const n = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))

export async function loadInventory(channel: MarketplaceChannel): Promise<InventoryView> {
  const creds = await resolveMarketplaceCreds(channel)
  const warehouse = primaryWarehouse(creds)
  const [{ buffer }, rows, runs] = await Promise.all([stockSettings(channel), marketStockRows(channel, warehouse), lastRuns(channel)])
  const plan = planPush(rows, buffer)
  const out: InventoryRow[] = plan.map(p => ({
    sku: p.row.sku,
    title: p.row.title,
    listingStatus: p.row.listing_status,
    available: n(p.row.available),
    reserved: Number(p.row.reserved) || 0,
    desired: p.qty,
    pushedQty: p.row.pushed_qty,
    pushedAt: p.row.pushed_at ? new Date(p.row.pushed_at).toISOString() : null,
    pushError: p.row.push_error,
    ourPrice: n(p.row.our_price),
    listedPrice: n(p.row.listed_price),
  }))
  const drift = (r: InventoryRow) => r.ourPrice != null && r.listedPrice != null && Math.abs(r.ourPrice - r.listedPrice) >= 0.01
  const lastPushAt = out.reduce<string | null>((m, r) => (r.pushedAt && (!m || r.pushedAt > m) ? r.pushedAt : m), null)
  return {
    buffer,
    warehouse,
    rows: out.sort((a, b) => Number(!!b.pushError) - Number(!!a.pushError) || Number(b.desired !== b.pushedQty) - Number(a.desired !== a.pushedQty) || a.title.localeCompare(b.title)),
    totals: {
      rows: out.length,
      pending: plan.filter(p => p.changed).length,
      errors: out.filter(r => r.pushError).length,
      drift: out.filter(drift).length,
      neverPushed: out.filter(r => r.pushedAt == null).length,
    },
    lastRun: runs.stock ?? null,
    lastPushAt,
  }
}
