import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as any[], query: [] as { sql: string; params: any[] }[], buffer: null as string | null }))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    state.query.push({ sql, params })
    return { rows: [], rowCount: 0 }
  }),
  queryMany: vi.fn(async (sql: string) => (sql.includes('FROM marketplace_listings l') ? state.rows : [])),
}))
vi.mock('@/lib/google-ads/notify', () => ({ readSetting: vi.fn(async () => state.buffer), writeSettings: vi.fn(async () => {}) }))
vi.mock('@/lib/integrations/resolve', () => ({
  MARKETPLACE_PROVIDER: { myntra: 'myntra', ajio: 'ajio' },
  IntegrationNotConnectedError: class extends Error {},
  resolveMarketplaceCreds: vi.fn(async () => ({ mode: 'live', fields: { warehouse_ids: ' 36, 52' }, endpoints: {} })),
}))
vi.mock('@/lib/channels/sync-run', async () => {
  class ChannelJobBusyError extends Error {}
  return {
    ChannelJobBusyError,
    errorText: (e: any) => String(e?.message ?? e),
    lastRuns: vi.fn(async () => ({})),
    withChannelLock: vi.fn(async (_c: string, _job: string, _kind: string, fn: any) => {
      const counts: Record<string, number> = {}
      const errors: { step: string; message: string }[] = []
      const step = async (name: string, f: () => Promise<number | void>) => {
        try {
          const n = await f()
          if (typeof n === 'number') counts[name] = (counts[name] ?? 0) + n
        } catch (e: any) {
          errors.push({ step: name, message: String(e?.message ?? e) })
        }
      }
      await fn({ counts, errors, step })
      return { id: 'run-1', status: errors.length ? 'partial' : 'success', counts, errors }
    }),
  }
})

import { batchOutcome, desiredQuantity, planPush, primaryWarehouse, pushMarketplaceStock, type MarketStockRow } from '@/lib/marketplace/stock'
import { AdapterUnavailableError, type MarketplaceAdapter } from '@/lib/marketplace/adapter'
import { mockAdapter } from '@/lib/marketplace/mock'

function row(i: number, over: Partial<MarketStockRow> = {}): MarketStockRow {
  return {
    listing_id: `l${i}`,
    sku: `MYN-${i}`,
    product_id: `p${i}`,
    variant_id: null,
    sub_variant_id: null,
    title: `Tee ${i}`,
    listing_status: 'live',
    available: '10',
    reserved: '0',
    sellable: true,
    our_price: '499',
    listed_price: '499',
    pushed_qty: 10,
    pushed_at: '2026-11-06T10:00:00Z',
    push_error: null,
    ...over,
  }
}

beforeEach(() => {
  state.rows = []
  state.query = []
  state.buffer = null
})

describe('desiredQuantity', () => {
  it('takes off reserved units and the buffer, never below zero', () => {
    expect(desiredQuantity(10, 2, 3)).toBe(5)
    expect(desiredQuantity(10.9, 0, 0)).toBe(10)
    expect(desiredQuantity(2, 1, 5)).toBe(0)
  })
  it('sends zero for unsellable or unknown stock', () => {
    expect(desiredQuantity(10, 0, 0, false)).toBe(0)
    expect(desiredQuantity(null, 0, 0)).toBe(0)
    expect(desiredQuantity(Number.NaN, 0, 0)).toBe(0)
  })
})

describe('planPush', () => {
  it('flags rows whose quantity changed or whose last push failed', () => {
    const plan = planPush([row(1), row(2, { available: '8' }), row(3, { push_error: 'Timeout' }), row(4, { sellable: false }), row(5, { reserved: '2', pushed_qty: null })], 0)
    expect(plan.map(p => [p.qty, p.changed])).toEqual([
      [10, false],
      [8, true],
      [10, true],
      [0, true],
      [8, true],
    ])
  })
  it('applies the buffer to every row', () => {
    expect(planPush([row(1)], 4)[0]).toMatchObject({ qty: 6, changed: true })
  })
})

describe('batchOutcome', () => {
  const batch = planPush([row(1, { available: '3' }), row(2, { available: '4' })], 0)
  it('treats an empty answer as the whole batch accepted', () => {
    expect(batchOutcome(batch, [])).toEqual([
      { sku: 'MYN-1', qty: 3, error: null },
      { sku: 'MYN-2', qty: 4, error: null },
    ])
  })
  it('records refusals and SKUs the marketplace did not answer for', () => {
    expect(batchOutcome(batch, [{ sku: 'MYN-1', ok: false, error: 'Unknown SKU' }]).map(o => o.error)).toEqual(['Unknown SKU', 'No answer for this SKU'])
  })
})

describe('primaryWarehouse', () => {
  it('uses the first saved warehouse ID', () => {
    expect(primaryWarehouse({ fields: { warehouse_ids: ' 36, 52' } } as any)).toBe('36')
    expect(primaryWarehouse(null)).toBe('')
  })
})

describe('pushMarketplaceStock', () => {
  it('sends only changed rows in batches of the endpoint size, paced, and saves each outcome', async () => {
    state.rows = Array.from({ length: 120 }, (_, i) => row(i, i < 70 ? { available: '5' } : {}))
    const base = mockAdapter('myntra')
    const pushInventory = vi.fn(async (updates: any[]) => updates.map(u => ({ sku: u.sku, warehouseId: u.warehouseId, ok: u.sku !== 'MYN-3', error: u.sku === 'MYN-3' ? 'SKU blocked' : undefined })))
    const adapter: MarketplaceAdapter = { ...base, pushInventory }
    const wait = vi.fn(async () => {})

    const res = await pushMarketplaceStock('myntra', { adapter, wait })

    expect(pushInventory).toHaveBeenCalledTimes(2)
    expect(pushInventory.mock.calls[0][0]).toHaveLength(50)
    expect(pushInventory.mock.calls[1][0]).toHaveLength(20)
    expect(pushInventory.mock.calls[0][0][0]).toEqual({ sku: 'MYN-0', quantity: 5, warehouseId: '36' })
    expect(wait).toHaveBeenCalledTimes(1)
    expect(wait).toHaveBeenCalledWith(200)
    expect(res).toMatchObject({ counts: { changed: 70, pushed: 69, failed: 1 } })
    expect(res!.errors[0].message).toMatch(/MYN-3: SKU blocked/)

    expect(state.query[0].sql).toContain('INSERT INTO marketplace_inventory_state')
    expect(JSON.parse(state.query[0].params[2])).toHaveLength(120)
    const saved = state.query.filter(q => q.sql.startsWith('UPDATE marketplace_inventory_state')).flatMap(q => JSON.parse(q.params[2]))
    expect(saved).toHaveLength(70)
    expect(saved.find((s: any) => s.sku === 'MYN-3')).toEqual({ sku: 'MYN-3', qty: 5, error: 'SKU blocked' })
  })

  it('applies the saved buffer', async () => {
    state.buffer = '2'
    state.rows = [row(1)]
    const pushInventory = vi.fn(async () => [])
    await pushMarketplaceStock('myntra', { adapter: { ...mockAdapter('myntra'), pushInventory }, wait: async () => {} })
    expect(pushInventory).toHaveBeenCalledWith([{ sku: 'MYN-1', quantity: 8, warehouseId: '36' }])
  })

  it('skips the run when nothing changed and only changes were asked for', async () => {
    state.rows = [row(1), row(2)]
    const pushInventory = vi.fn()
    const res = await pushMarketplaceStock('myntra', { onlyIfChanged: true, adapter: { ...mockAdapter('myntra'), pushInventory } })
    expect(res).toBeNull()
    expect(pushInventory).not.toHaveBeenCalled()
  })

  it('stops after a batch when the marketplace is unavailable, marking that batch failed', async () => {
    state.rows = Array.from({ length: 60 }, (_, i) => row(i, { available: '1' }))
    const pushInventory = vi.fn(async () => {
      throw new AdapterUnavailableError('myntra', 'Myntra is down')
    })
    const res = await pushMarketplaceStock('myntra', { adapter: { ...mockAdapter('myntra'), pushInventory }, wait: async () => {} })
    expect(pushInventory).toHaveBeenCalledTimes(1)
    expect(res?.status).toBe('partial')
    const saved = state.query.filter(q => q.sql.startsWith('UPDATE marketplace_inventory_state')).flatMap(q => JSON.parse(q.params[2]))
    expect(saved).toHaveLength(50)
    expect(saved.every((s: any) => s.error)).toBe(true)
  })
})
