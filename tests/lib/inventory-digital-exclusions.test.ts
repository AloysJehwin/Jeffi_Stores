import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(async () => []),
  getClient: vi.fn(),
}))

import { query } from '@/lib/shared/db'
import { getInventorySync, recomputeStockStatusForProduct } from '@/lib/orders/inventory'
import { readFileSync } from 'node:fs'

describe('digital products are never stock-tracked', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getInventorySync masks the flag for digital products in SQL', async () => {
    const client = {
      query: vi.fn(async (_sql: string, _p?: any[]) => ({
        rows: [{ inventory_sync: false, low_stock_threshold: null }],
      })),
    }
    const r = await getInventorySync(client, 'p1')
    expect(r.enabled).toBe(false)
    expect(String(client.query.mock.calls[0][0])).toMatch(/inventory_sync AND NOT COALESCE\(is_digital, FALSE\)/)
  })

  it('recompute is a no-op when sync is masked off', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ inventory_sync: false }] } as any)
    await recomputeStockStatusForProduct(null, 'p1')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['controller-service/src/lib/shared/daily-briefing.ts', /is_digital = FALSE AND inventory_quantity <= 10/],
    [
      'controller-service/src/lib/admin-agent/tools/catalog.ts',
      /p\.is_active = TRUE AND p\.is_digital = FALSE\s+AND \(p\.inventory_quantity <= \$1/,
    ],
    ['controller-service/src/lib/shared/dashboard-insights.ts', /COALESCE\(p\.is_draft, false\) = false AND p\.is_digital = false/],
    ['controller-service/src/app/api/(admin)/admin/inventory/po/[id]/receive/route.ts', /is digital — it has no stock to receive/],
  ])('%s excludes digital products', (file, pattern) => {
    expect(readFileSync(file, 'utf8')).toMatch(pattern)
  })
})
