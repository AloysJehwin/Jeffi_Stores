import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/amazon/client', () => ({
  matchAsin: vi.fn(),
  getSellerId: vi.fn().mockResolvedValue('SELLER-123'),
}))

import { backfillAsins } from '@/lib/amazon/asin-backfill'
import * as db from '@/lib/db'
import * as client from '@/lib/amazon/client'

const mockQuery = vi.mocked(db.query)
const mockQueryMany = vi.mocked(db.queryMany)
const mockMatchAsin = vi.mocked(client.matchAsin)
const mockGetSellerId = vi.mocked(client.getSellerId)

describe('amazon/asin-backfill', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetSellerId.mockResolvedValue('SELLER-123')
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([])
    mockMatchAsin.mockResolvedValue(null)
  })

  it('dry run (default): matches gtin + keyword, applies nothing', async () => {
    // variants query then simples query
    mockQueryMany
      .mockResolvedValueOnce([
        { id: 'v1', sku: 'V1', gtin: '111', mpn: null, variant_name: 'Red', product_name: 'Widget', product_gtin: null, product_mpn: null, brand: 'Acme' },
      ] as any)
      .mockResolvedValueOnce([
        { id: 'p1', sku: 'P1', gtin: null, mpn: 'MPN9', product_name: 'Gadget', brand: 'Beta' },
      ] as any)

    mockMatchAsin
      .mockResolvedValueOnce({ asin: 'B0GTIN', matchType: 'gtin' } as any)
      .mockResolvedValueOnce({ asin: 'B0KW', matchType: 'keyword' } as any)

    const rep = await backfillAsins()
    expect(rep.dryRun).toBe(true)
    expect(rep.scanned).toBe(2)
    expect(rep.matched).toBe(2)
    expect(rep.gtin).toBe(1)
    expect(rep.keyword).toBe(1)
    expect(rep.unmatched).toBe(0)
    expect(rep.applied).toBe(0)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('unmatched rows counted, confidence null', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        { id: 'v1', sku: 'V1', product_name: 'W', brand: 'Acme' },
      ] as any)
      .mockResolvedValueOnce([] as any)
    mockMatchAsin.mockResolvedValueOnce(null)

    const rep = await backfillAsins()
    expect(rep.matched).toBe(0)
    expect(rep.unmatched).toBe(1)
    expect(rep.rows[0].confidence).toBeNull()
  })

  it('non-dry-run applies variant + product updates', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        { id: 'v1', sku: 'V1', gtin: '111', product_name: 'W', brand: 'Acme' },
      ] as any)
      .mockResolvedValueOnce([
        { id: 'p1', sku: 'P1', product_name: 'G', brand: 'Beta' },
      ] as any)
    mockMatchAsin
      .mockResolvedValueOnce({ asin: 'B0V', matchType: 'gtin' } as any)
      .mockResolvedValueOnce({ asin: 'B0P', matchType: 'keyword' } as any)

    const rep = await backfillAsins({ dryRun: false })
    expect(rep.applied).toBe(2)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE product_variants'), ['B0V', 'gtin', 'v1'])
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE products'), ['B0P', 'keyword', 'p1'])
  })

  it('non-dry-run skips rows without asin and swallows update errors', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        { id: 'v1', sku: 'V1', gtin: '111', product_name: 'W', brand: 'Acme' },
        { id: 'v2', sku: 'V2', gtin: '222', product_name: 'W2', brand: 'Acme' },
      ] as any)
      .mockResolvedValueOnce([] as any)
    mockMatchAsin
      .mockResolvedValueOnce({ asin: 'B0V', matchType: 'gtin' } as any) // v1 matched
      .mockResolvedValueOnce(null) // v2 unmatched -> skipped
    mockQuery.mockRejectedValueOnce(new Error('update fail')) // v1 update throws -> swallowed

    const rep = await backfillAsins({ dryRun: false })
    expect(rep.applied).toBe(0) // update threw for v1, v2 has no asin
  })

  it('passes brand clause when brand provided', async () => {
    mockQueryMany.mockResolvedValue([] as any)
    await backfillAsins({ brand: 'Acme', dryRun: true })
    // first call (variants) should include brand arg
    const variantsArgs = mockQueryMany.mock.calls[0][1] as any[]
    expect(variantsArgs).toEqual(['Acme'])
    expect(String(mockQueryMany.mock.calls[0][0])).toContain('b.name = $1')
  })

  it('limit is clamped between 1 and 5000', async () => {
    mockQueryMany.mockResolvedValue([] as any)
    await backfillAsins({ limit: 999999 })
    expect(String(mockQueryMany.mock.calls[0][0])).toContain('LIMIT 5000')

    vi.clearAllMocks()
    mockQueryMany.mockResolvedValue([] as any)
    await backfillAsins({ limit: 0 })
    // limit 0 -> Math.max(1, 0||2000)=2000
    expect(String(mockQueryMany.mock.calls[0][0])).toContain('LIMIT 2000')
  })

  it('fetchTargets swallows query errors -> empty rows', async () => {
    mockQueryMany.mockRejectedValue(new Error('db down'))
    const rep = await backfillAsins()
    expect(rep.scanned).toBe(0)
    expect(rep.rows).toEqual([])
  })

  it('matchWithBackoff retries on 429 then succeeds', async () => {
    vi.useFakeTimers()
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'v1', sku: 'V1', product_name: 'W', brand: 'Acme' }] as any)
      .mockResolvedValueOnce([] as any)
    const err429: any = new Error('429'); err429.status = 429; err429.retryAfter = '0'
    mockMatchAsin.mockRejectedValueOnce(err429).mockResolvedValueOnce({ asin: 'B0', matchType: 'gtin' } as any)

    const p = backfillAsins()
    await vi.runAllTimersAsync()
    const rep = await p
    vi.useRealTimers()
    expect(rep.matched).toBe(1)
    expect(mockMatchAsin).toHaveBeenCalledTimes(2)
  })

  it('matchWithBackoff returns null on non-429 error', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'v1', sku: 'V1', product_name: 'W', brand: 'Acme' }] as any)
      .mockResolvedValueOnce([] as any)
    const err: any = new Error('500'); err.status = 500
    mockMatchAsin.mockRejectedValueOnce(err)

    const rep = await backfillAsins()
    expect(rep.matched).toBe(0)
    expect(mockMatchAsin).toHaveBeenCalledTimes(1)
  })

  it('matchWithBackoff gives up after MAX_RETRIES 429s', async () => {
    vi.useFakeTimers()
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'v1', sku: 'V1', product_name: 'W', brand: 'Acme' }] as any)
      .mockResolvedValueOnce([] as any)
    const err429: any = new Error('429'); err429.status = 429
    mockMatchAsin.mockRejectedValue(err429)

    const p = backfillAsins()
    await vi.runAllTimersAsync()
    const rep = await p
    vi.useRealTimers()
    expect(rep.matched).toBe(0)
  })

  it('caps rows sample at 100', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `v${i}`, sku: `V${i}`, product_name: 'W', brand: 'Acme' }))
    mockQueryMany
      .mockResolvedValueOnce(many as any)
      .mockResolvedValueOnce([] as any)
    const rep = await backfillAsins()
    expect(rep.scanned).toBe(150)
    expect(rep.rows).toHaveLength(100)
  })
})
