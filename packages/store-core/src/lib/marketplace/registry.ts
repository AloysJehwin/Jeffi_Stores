import { queryOne } from '@/lib/shared/db'
import { resolveMarketplaceCreds, type MarketplaceCreds } from '@/lib/integrations/resolve'
import type { MarketplaceAdapter } from './adapter'
import { ajioAdapter } from './ajio'
import { mockAdapter, mockTestOrder } from './mock'
import { myntraAdapter } from './myntra'
import { orderNumberFor } from './upsert'
import { CHANNEL_LABEL, type MarketplaceChannel } from './types'

// Adapter per channel and mode, the credential fields each marketplace asks for, and the connect
// panel's "Send test order". The live/sandbox adapters read their addresses and field names from
// endpoints.ts and their mapping objects, so partner-doc corrections are config edits.

export interface MarketplaceField {
  key: string
  label: string
  secret?: boolean
  placeholder?: string
}

export const MARKETPLACE_FIELDS: Record<MarketplaceChannel, MarketplaceField[]> = {
  myntra: [
    { key: 'merchant_id', label: 'Merchant ID', placeholder: 'From Myntra Partner Portal' },
    { key: 'secret_key', label: 'Secret Key', secret: true },
    { key: 'warehouse_ids', label: 'Store/Warehouse IDs', placeholder: 'Comma-separated, e.g. 1234, 5678' },
  ],
  ajio: [
    { key: 'seller_id', label: 'Seller ID', placeholder: 'From AJIO Seller Central' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'pob_id', label: 'POB ID', placeholder: 'DV…' },
  ],
}

/** Mock, or the live/sandbox adapter driven by endpoints.ts and the store's credentials. */
export function getAdapter(channel: MarketplaceChannel, creds: Pick<MarketplaceCreds, 'mode'> & Partial<Pick<MarketplaceCreds, 'fields' | 'endpoints'>>): MarketplaceAdapter {
  if (creds.mode === 'mock') return mockAdapter(channel)
  const c = { mode: creds.mode, fields: creds.fields ?? {}, endpoints: creds.endpoints }
  return channel === 'myntra' ? myntraAdapter(c) : ajioAdapter(c)
}

/** A sellable unit with stock and a SKU: a mapped listing first, then any leaf unit. */
async function testSku(channel: MarketplaceChannel): Promise<{ sku: string; price: number } | null> {
  return queryOne<{ sku: string; price: number }>(
    `SELECT sku, price::float8 AS price FROM (
       SELECT l.marketplace_sku AS sku, COALESCE(sv.price, v.price, p.base_price) AS price,
              COALESCE(sv.inventory_quantity, v.inventory_quantity, p.inventory_quantity) AS qty, 0 AS rank
         FROM marketplace_listings l JOIN products p ON p.id = l.product_id
         LEFT JOIN product_variants v ON v.id = l.variant_id LEFT JOIN product_sub_variants sv ON sv.id = l.sub_variant_id
        WHERE l.channel = $1 AND l.marketplace_sku IS NOT NULL AND NOT p.is_digital
       UNION ALL
       SELECT sv.sku, COALESCE(sv.price, v.price, p.base_price), sv.inventory_quantity, 1
         FROM product_sub_variants sv JOIN product_variants v ON v.id = sv.variant_id JOIN products p ON p.id = sv.product_id
        WHERE sv.is_active AND v.is_active AND COALESCE(p.is_active, true) AND NOT p.is_digital
       UNION ALL
       SELECT v.sku, COALESCE(v.price, p.base_price), v.inventory_quantity, 2
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active AND COALESCE(p.is_active, true) AND NOT p.is_digital
          AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = v.id AND sv.is_active)
       UNION ALL
       SELECT p.sku, p.base_price, p.inventory_quantity, 3 FROM products p
        WHERE COALESCE(p.is_active, true) AND NOT p.is_digital
          AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active)
     ) u
     WHERE sku IS NOT NULL AND sku <> '' AND qty >= 1
     ORDER BY rank LIMIT 1`,
    [channel]
  )
}

/** Records a fake order push through the normal ingest path and processes it, so stock really moves.
 * Mock and sandbox modes only. */
export async function sendMockTestOrder(channel: MarketplaceChannel): Promise<{ orderNumber: string }> {
  const creds = await resolveMarketplaceCreds(channel)
  if (!creds) throw new Error(`Connect ${CHANNEL_LABEL[channel]} first.`)
  if (creds.mode === 'live') throw new Error('Test orders are only available in mock or sandbox mode.')
  const unit = await testSku(channel)
  if (!unit) throw new Error('A test order needs at least one product with a SKU and stock.')
  const orderId = `TEST-${Date.now().toString(36).toUpperCase()}`
  const adapter = mockAdapter(channel)
  const events = adapter.parsePush(mockTestOrder(unit.sku, Number(unit.price) || 0, orderId), new Headers())
  const { recordEvents, processEvent } = await import('./ingest')
  const { ids } = await recordEvents(channel, events, 'mock')
  for (const id of ids) {
    const r = await processEvent(id)
    if (r.outcome !== 'done') throw new Error(r.error ?? 'The test order could not be processed.')
  }
  return { orderNumber: orderNumberFor(channel, orderId) }
}
