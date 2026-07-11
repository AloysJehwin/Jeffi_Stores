import { queryMany } from './db'
import type { DeliverySettings } from './delivery-rules'

export type { DeliverySettings, ApplyDeliverySource, ApplyDeliveryResult } from './delivery-rules'
export { applyDeliveryRules } from './delivery-rules'

const DEFAULTS: DeliverySettings = {
  enabled: true,
  freeThreshold: 0,
}

const KEYS = [
  'delivery_charges_enabled',
  'delivery_free_threshold',
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
