import { describe, it, expect, beforeEach, vi } from 'vitest'

const lockClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  getClient: vi.fn(),
}))
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test' }),
    })),
  },
}))
vi.mock('@/lib/merchant/mapper', () => ({
  productToGmcItems: vi.fn(),
  gmcItemProblem: vi.fn(),
}))
vi.mock('@/lib/merchant/client', () => ({
  insertProductInput: vi.fn(),
  deleteProductByOfferId: vi.fn(),
  listProducts: vi.fn(),
  resolveDataSource: vi.fn(),
  merchantConfigured: vi.fn().mockResolvedValue(true),
  GMC_PUSH_DISABLED: false,
}))
vi.mock('@/lib/shared/customer-links', () => ({ catalogBaseUrl: vi.fn() }))

import {
  syncAllProductsToMerchant,
  syncProductToMerchant,
  getLastSyncStatus,
  sendSyncFailureEmail,
  isMerchantSyncRunning,
  MerchantSyncInProgressError,
} from '@/lib/merchant/sync'
import * as db from '@/lib/shared/db'
import * as mapper from '@/lib/merchant/mapper'
import * as client from '@/lib/merchant/client'
import * as links from '@/lib/shared/customer-links'

const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockQuery = vi.mocked(db.query)
const mockProductToGmcItems = vi.mocked(mapper.productToGmcItems)
const mockInsert = vi.mocked(client.insertProductInput)
const mockDeleteProductByOfferId = vi.mocked(client.deleteProductByOfferId)
const mockListProducts = vi.mocked(client.listProducts)
const DS = 'accounts/1/dataSources/9'
const BASE = 'https://store.example.com'

// A ProductInput that passes gmcItemProblem.
const good = (offerId: string) => ({
  offerId,
  productAttributes: { title: 't', imageLink: 'https://x/a.png', price: { amountMicros: '1000000', currencyCode: 'INR' } },
})

describe('merchant/sync', () => {
  beforeEach(() => {
    // resetAllMocks clears call history AND Once queues AND implementations,
    // preventing Once entries queued in one test from leaking into the next.
    vi.resetAllMocks()
    // queryMany is iterated directly in runFullSync — must always return an array.
    mockQueryMany.mockResolvedValue([])
    // query is called for advisory unlock and saveSyncStatus — needs a safe default.
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    // listProducts is called in getExistingGmcOfferIds — needs a safe default.
    mockListProducts.mockResolvedValue({ products: [], nextPageToken: undefined } as any)
    // resetAllMocks wipes factory implementations — re-stub them.
    vi.mocked(client.resolveDataSource).mockResolvedValue(DS)
    vi.mocked(links.catalogBaseUrl).mockResolvedValue(BASE)
    mockInsert.mockResolvedValue({} as any)
    vi.mocked(client.merchantConfigured).mockResolvedValue(true)
    vi.mocked(db.getClient).mockResolvedValue(lockClient as any)
    lockClient.query.mockImplementation(async (sql: string) =>
      /pg_try_advisory_lock/.test(sql) ? { rows: [{ acquired: true }] } : { rows: [{}] }
    )
  })

  describe('getLastSyncStatus', () => {
    it('returns last sync log entry', async () => {
      const fakeLog = { id: 1, status: 'success', synced: 10, deleted: 0, errors: null }
      mockQueryOne.mockResolvedValueOnce(fakeLog)

      const result = await getLastSyncStatus()
      expect(result).toEqual(fakeLog)
    })

    it('returns null when no sync log exists', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getLastSyncStatus()
      expect(result).toBeNull()
    })

    it('returns null on db error', async () => {
      mockQueryOne.mockRejectedValueOnce(new Error('DB error'))
      const result = await getLastSyncStatus()
      expect(result).toBeNull()
    })
  })

  describe('syncAllProductsToMerchant', () => {
    it('refuses a second sync while the advisory lock is held', async () => {
      lockClient.query.mockImplementation(async (sql: string) =>
        /pg_try_advisory_lock/.test(sql) ? { rows: [{ acquired: false }] } : { rows: [{}] }
      )

      await expect(syncAllProductsToMerchant()).rejects.toBeInstanceOf(MerchantSyncInProgressError)
      await expect(syncAllProductsToMerchant()).rejects.toThrow(/already running/)
      expect(mockQueryMany).not.toHaveBeenCalled()
      expect(lockClient.query).not.toHaveBeenCalledWith(expect.stringMatching(/advisory_unlock/), expect.anything())
      expect(lockClient.release).toHaveBeenCalledTimes(2)
    })

    it('takes and releases the lock on the same dedicated connection', async () => {
      await syncAllProductsToMerchant()
      const sqls = lockClient.query.mock.calls.map(c => c[0])
      expect(sqls[0]).toMatch(/pg_try_advisory_lock/)
      expect(sqls[sqls.length - 1]).toMatch(/pg_advisory_unlock/)
      expect(lockClient.release).toHaveBeenCalledWith(undefined)
    })

    it('releases the lock even when the run throws', async () => {
      mockQueryMany.mockRejectedValueOnce(new Error('db down'))
      await expect(syncAllProductsToMerchant()).rejects.toThrow('db down')
      expect(lockClient.query).toHaveBeenCalledWith(expect.stringMatching(/pg_advisory_unlock/), expect.anything())
      expect(lockClient.release).toHaveBeenCalledTimes(1)
    })

    it('destroys the connection when the unlock fails so a stale lock is not pooled', async () => {
      lockClient.query.mockImplementation(async (sql: string) => {
        if (/pg_advisory_unlock/.test(sql)) throw new Error('connection lost')
        return /pg_try_advisory_lock/.test(sql) ? { rows: [{ acquired: true }] } : { rows: [{}] }
      })
      await syncAllProductsToMerchant()
      expect(lockClient.release).toHaveBeenCalledWith(true)
    })

    it('records a chunk where every insert failed the same way once, with its item count', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'A' }])
      mockProductToGmcItems.mockReturnValueOnce([good('A1'), good('A2')])
      mockInsert.mockRejectedValue(new Error('HTTP 403: forbidden'))
      const result = await syncAllProductsToMerchant()
      expect(result.errors).toContainEqual({ sku: 'batch-0', error: 'HTTP 403: forbidden', items: 2 })
      expect(result.synced).toBe(0)
    })

    it('skips the rest of the run after repeated identical chunk failures', async () => {
      const items = Array.from({ length: 600 }, (_, i) => good(`S${i}`))
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'P' }])
      mockProductToGmcItems.mockReturnValueOnce(items)
      mockInsert.mockRejectedValue(new Error('HTTP 503: unavailable'))
      const result = await syncAllProductsToMerchant()
      expect(mockInsert).toHaveBeenCalledTimes(300)
      const skipped = result.errors.find(e => /Skipped after 3/.test(e.error))
      expect(skipped?.items).toBe(300)
    })

    it('reports per-item rejections with the SKU and counts the rest as synced', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'P' }])
      mockProductToGmcItems.mockReturnValueOnce([good('OK1'), good('BAD'), good('OK2')])
      mockInsert.mockImplementation(async (item: any) => {
        if (item.offerId === 'BAD') throw new Error('HTTP 400: Invalid price')
        return {}
      })
      const result = await syncAllProductsToMerchant()
      expect(result.synced).toBe(2)
      expect(result.errors).toEqual([{ sku: 'BAD', error: 'HTTP 400: Invalid price' }])
    })

    it('inserts every item into the resolved data source, at most 5 at a time', async () => {
      let inFlight = 0
      let peak = 0
      mockInsert.mockImplementation(async () => {
        peak = Math.max(peak, ++inFlight)
        await new Promise(r => setTimeout(r, 1))
        inFlight--
        return {}
      })
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'P' }])
      mockProductToGmcItems.mockReturnValueOnce(Array.from({ length: 12 }, (_, i) => good(`C${i}`)))
      const result = await syncAllProductsToMerchant()
      expect(result.synced).toBe(12)
      expect(peak).toBeLessThanOrEqual(5)
      expect(mockInsert).toHaveBeenCalledWith(good('C0'), { dataSource: DS })
    })

    it('builds product links from the store base url', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'P' }])
      mockProductToGmcItems.mockReturnValueOnce([])
      await syncAllProductsToMerchant()
      expect(mockProductToGmcItems).toHaveBeenCalledWith({ id: 'p1', sku: 'P' }, BASE, { velocity: expect.objectContaining({ windowDays: 60 }) })
      // recent sales for the best seller / slow mover label: one aggregate per run
      expect(mockQueryMany.mock.calls.filter(c => String(c[0]).includes('FROM order_items'))).toHaveLength(1)
    })

    it('stops before pushing when the data source cannot be resolved', async () => {
      vi.mocked(client.resolveDataSource).mockRejectedValueOnce(
        new Error('Could not find or create the Merchant API data source: HTTP 403: denied')
      )
      const result = await syncAllProductsToMerchant()
      expect(result.errors).toEqual([
        { sku: '__datasource__', error: 'Could not find or create the Merchant API data source: HTTP 403: denied' },
      ])
      expect(mockQueryMany).not.toHaveBeenCalled()
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('does not push items with missing images or prices and says why', async () => {
      const actual = await vi.importActual<typeof import('@/lib/merchant/mapper')>('@/lib/merchant/mapper')
      vi.mocked(mapper.gmcItemProblem).mockImplementation(actual.gmcItemProblem)
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'P' }])
      const noImg = good('NOIMG')
      noImg.productAttributes.imageLink = ''
      mockProductToGmcItems.mockReturnValueOnce([noImg, good('OK')])
      const result = await syncAllProductsToMerchant()
      expect(result.errors).toContainEqual({ sku: 'NOIMG', error: 'Missing product image' })
      expect(mockInsert).toHaveBeenCalledTimes(1)
      expect(result.synced).toBe(1)
    })

    it('deletes our offers that are no longer active, leaving other data sources alone', async () => {
      mockListProducts.mockResolvedValueOnce({
        products: [
          { offerId: 'OLD-SKU', dataSource: DS },
          { offerId: 'FROM-FILE', dataSource: 'accounts/1/dataSources/2' },
        ],
        nextPageToken: undefined,
      } as any)
      const result = await syncAllProductsToMerchant()
      expect(result.deleted).toBe(1)
      expect(mockDeleteProductByOfferId).toHaveBeenCalledWith('OLD-SKU', DS)
      expect(mockDeleteProductByOfferId).not.toHaveBeenCalledWith('FROM-FILE', expect.anything())
    })

    it('handles productToGmcItems exception per product', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'BAD-SKU', name: 'Bad' }])
      mockProductToGmcItems.mockImplementationOnce(() => {
        throw new Error('mapping failed')
      })
      const result = await syncAllProductsToMerchant()
      expect(result.errors.some(e => e.sku === 'BAD-SKU')).toBe(true)
    })

    it('paginates through the processed product list', async () => {
      mockListProducts
        .mockResolvedValueOnce({ products: [{ offerId: 'PAGE1-SKU' }], nextPageToken: 'token-page2' } as any)
        .mockResolvedValueOnce({ products: [{ offerId: 'PAGE2-SKU' }], nextPageToken: undefined } as any)
      const result = await syncAllProductsToMerchant()
      expect(result.deleted).toBe(2)
      expect(mockListProducts).toHaveBeenLastCalledWith('token-page2')
    })
  })

  describe('isMerchantSyncRunning', () => {
    it('reports the advisory lock state from pg_locks', async () => {
      mockQueryOne.mockResolvedValueOnce({ running: true })
      expect(await isMerchantSyncRunning()).toBe(true)
      expect(mockQueryOne.mock.calls[0][0]).toMatch(/pg_locks/)
    })

    it('returns false on db error', async () => {
      mockQueryOne.mockRejectedValueOnce(new Error('x'))
      expect(await isMerchantSyncRunning()).toBe(false)
    })
  })

  describe('syncProductToMerchant', () => {
    it('does nothing when product not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await syncProductToMerchant('nonexistent-id')
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('maps with the store base url and inserts each item', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'p1', sku: 'SKU-001', product_variants: [] })
      mockProductToGmcItems.mockReturnValueOnce([good('SKU-001')])
      await syncProductToMerchant('p1')
      expect(mockProductToGmcItems).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), BASE, { velocity: expect.anything() })
      expect(mockInsert).toHaveBeenCalledWith(good('SKU-001'))
    })

    it('upserts inactive product as out_of_stock (not deleted)', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        sku: 'SKU-001',
        is_active: false,
        product_variants: [],
      })
      mockProductToGmcItems.mockReturnValueOnce([{ offerId: 'SKU-001', availability: 'OUT_OF_STOCK' }])
      await syncProductToMerchant('p1')
      expect(mockInsert).toHaveBeenCalledWith({ offerId: 'SKU-001', availability: 'OUT_OF_STOCK' })
      expect(mockDeleteProductByOfferId).not.toHaveBeenCalled()
    })

    it('upserts all variant items for inactive product with variants as out_of_stock', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        sku: 'SKU-001',
        is_active: false,
        product_variants: [{ sku: 'SKU-001-S' }, { sku: 'SKU-001-L' }],
      })
      mockProductToGmcItems.mockReturnValueOnce([
        { offerId: 'SKU-001-S', availability: 'OUT_OF_STOCK' },
        { offerId: 'SKU-001-L', availability: 'OUT_OF_STOCK' },
      ])
      await syncProductToMerchant('p1')
      expect(mockInsert).toHaveBeenCalledTimes(2)
      expect(mockDeleteProductByOfferId).not.toHaveBeenCalled()
    })

    it('upserts inactive product with sanitized sku', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        sku: 'SKU 001/test',
        is_active: false,
        product_variants: [],
      })
      mockProductToGmcItems.mockReturnValueOnce([{ offerId: 'SKU_001_test', availability: 'OUT_OF_STOCK' }])
      await syncProductToMerchant('p1')
      expect(mockInsert).toHaveBeenCalledWith({ offerId: 'SKU_001_test', availability: 'OUT_OF_STOCK' })
    })

    it('upserts each GMC item when product is active', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        sku: 'SKU-001',
        is_active: true,
        product_variants: [],
      })

      mockProductToGmcItems.mockReturnValueOnce([{ offerId: 'SKU-001', title: 'Widget' }])

      await syncProductToMerchant('p1')
      expect(mockInsert).toHaveBeenCalledWith({ offerId: 'SKU-001', title: 'Widget' })
    })

    it('upserts all variant items for active product with variants', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        sku: 'SKU-001',
        is_active: true,
        product_variants: [{ sku: 'SKU-001-S' }, { sku: 'SKU-001-L' }],
      })

      mockProductToGmcItems.mockReturnValueOnce([
        { offerId: 'SKU-001-S', title: 'Widget S' },
        { offerId: 'SKU-001-L', title: 'Widget L' },
      ])

      await syncProductToMerchant('p1')
      expect(mockInsert).toHaveBeenCalledTimes(2)
    })

    it('upserts active product with all variant items', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        sku: 'SKU-001',
        is_active: true,
        product_variants: [{ sku: 'SKU-001-S' }, { sku: 'SKU-001-L' }],
      })
      mockProductToGmcItems.mockReturnValueOnce([
        { offerId: 'SKU-001-S', title: 'Widget S' },
        { offerId: 'SKU-001-L', title: 'Widget L' },
      ])
      await syncProductToMerchant('p1')
      expect(mockInsert).toHaveBeenCalledTimes(2)
    })
  })

  describe('sendSyncFailureEmail', () => {
    it('completes without throwing even on SMTP error', async () => {
      const result: any = {
        synced: 5,
        deleted: 1,
        errors: [{ sku: 'SKU-001', error: 'Category mismatch' }],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }

      // nodemailer will fail since no SMTP configured, but function catches silently
      await expect(sendSyncFailureEmail(result)).resolves.not.toThrow()
    })

    it('handles more than 20 errors by truncating', async () => {
      const errors = Array.from({ length: 30 }, (_, i) => ({ sku: `SKU-${i}`, error: `Error ${i}` }))
      const result: any = {
        synced: 0,
        deleted: 0,
        errors,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }

      await expect(sendSyncFailureEmail(result)).resolves.not.toThrow()
    })

    it('handles empty errors array', async () => {
      const result: any = {
        synced: 100,
        deleted: 5,
        errors: [],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }

      await expect(sendSyncFailureEmail(result)).resolves.not.toThrow()
    })
  })
})
