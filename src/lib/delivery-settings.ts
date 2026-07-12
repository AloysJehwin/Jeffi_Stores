import { queryMany } from './db'
import type { DeliverySettings } from './delivery-rules'

export type { DeliverySettings, ApplyDeliverySource, ApplyDeliveryResult } from './delivery-rules'
export { applyDeliveryRules } from './delivery-rules'

const DEFAULTS: DeliverySettings = {
  enabled: true,
  freeThreshold: 0,
  discountPercent: 0,
  discountFlat: 0,
  discountMinSubtotal: 0,
  discountLabel: '',
}

const KEYS = [
  'delivery_charges_enabled',
  'delivery_free_threshold',
  'delivery_discount_percent',
  'delivery_discount_flat',
  'delivery_discount_min_subtotal',
  'delivery_discount_label',
]

let cache: { value: DeliverySettings; expiresAt: number } | null = null
const TTL_MS = 30 * 1000

export async function getDeliverySettings(): Promise<DeliverySettings> {
  if (cache && Date.now() < cache.expiresAt) return cache.value

  try {
    const rows = await queryMany<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`,
      [KEYS]
    )
    const map = new Map(rows.map(r => [r.key, r.value]))
    const parseNum = (v: string | undefined, def: number) => {
      if (v == null || v === '') return def
      const n = parseFloat(v)
      return Number.isFinite(n) ? n : def
    }
    const result: DeliverySettings = {
      enabled: (map.get('delivery_charges_enabled') ?? 'true').toLowerCase() === 'true',
      freeThreshold: Math.max(0, parseNum(map.get('delivery_free_threshold'), 0)),
      discountPercent: Math.min(100, Math.max(0, parseNum(map.get('delivery_discount_percent'), 0))),
      discountFlat: Math.max(0, parseNum(map.get('delivery_discount_flat'), 0)),
      discountMinSubtotal: Math.max(0, parseNum(map.get('delivery_discount_min_subtotal'), 0)),
      discountLabel: (map.get('delivery_discount_label') ?? '').trim(),
    }
    cache = { value: result, expiresAt: Date.now() + TTL_MS }
    return result
  } catch {
    return DEFAULTS
  }
}

export function invalidateDeliverySettingsCache() {
  cache = null
}
