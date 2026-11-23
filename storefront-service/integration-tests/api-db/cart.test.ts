// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront cart route group.
// Group: storefront-service/src/app/api/(public)/cart/**
// Only route: cart/free-delivery (GET). Public, no auth; reads site_settings via getDeliverySettings().
// Seeds site_settings keys, invalidates the 30s module cache, asserts real body from the DB read.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb } from '../../../packages/store-core/integration-tests/db/harness'
import { endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const KEYS = [
  'delivery_charges_enabled',
  'delivery_free_threshold',
  'delivery_rate_per_kg',
  'delivery_free_weight_ceiling_kg',
]

describe.skipIf(!API_DB_ENABLED)('cart/free-delivery API (real DB)', () => {
  let GET: () => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let invalidate: () => void

  async function setSetting(key: string, value: string) {
    await db.query(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    )
  }

  // Re-read the DB on the next GET (route has a 30s in-module cache).
  async function fetchFresh(): Promise<{ status: number; body: any }> {
    invalidate()
    const res = await GET()
    return { status: res.status, body: await res.json() }
  }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const route = await import('@storefront/app/api/(public)/cart/free-delivery/route')
    GET = route.GET as any
    const settings = await import('@/lib/shipping/delivery-settings')
    invalidate = settings.invalidateDeliverySettingsCache
    // Start from a clean slate for the keys this route reads.
    await db.query('DELETE FROM site_settings WHERE key = ANY($1::text[])', [KEYS])
  })

  afterAll(async () => {
    await db.query('DELETE FROM site_settings WHERE key = ANY($1::text[])', [KEYS]).catch(() => {})
    await endPool()
  })

  it('GET returns the seeded free threshold when delivery charges are enabled', async () => {
    await setSetting('delivery_charges_enabled', 'true')
    await setSetting('delivery_free_threshold', '1500')
    await setSetting('delivery_free_weight_ceiling_kg', '5')
    const { status, body } = await fetchFresh()
    expect(status).toBe(200)
    expect(body.freeThreshold).toBe(1500)
    expect(body.weightLimitKg).toBe(5)
  })

  it('GET returns freeThreshold 0 when delivery charges are disabled (threshold suppressed)', async () => {
    await setSetting('delivery_charges_enabled', 'false')
    await setSetting('delivery_free_threshold', '1500')
    const { status, body } = await fetchFresh()
    expect(status).toBe(200)
    expect(body.freeThreshold).toBe(0)
  })

  it('GET defaults weightLimitKg to 3 when the ceiling is unset/zero', async () => {
    await setSetting('delivery_charges_enabled', 'true')
    await setSetting('delivery_free_weight_ceiling_kg', '0')
    const { body } = await fetchFresh()
    expect(body.weightLimitKg).toBe(3)
  })

  it('GET falls back to defaults (threshold 0, weight 3) when no settings rows exist', async () => {
    await db.query('DELETE FROM site_settings WHERE key = ANY($1::text[])', [KEYS])
    const { status, body } = await fetchFresh()
    expect(status).toBe(200)
    expect(body.freeThreshold).toBe(0)
    expect(body.weightLimitKg).toBe(3)
  })

  it('GET sets a private no-store Cache-Control header', async () => {
    invalidate()
    const res = await GET()
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })
})
