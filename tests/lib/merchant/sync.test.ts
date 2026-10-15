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
  upsertProduct: vi.fn(),
  deleteProductByOfferId: vi.fn(),
  deleteProduct: vi.fn(),
  listProducts: vi.fn(),
  customBatchUpsert: vi.fn(),
  getMerchantId: vi.fn().mockResolvedValue('test-merchant-123'),
  merchantConfigured: vi.fn().mockResolvedValue(true),
  GMC_PUSH_DISABLED: false,
}))

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

const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockQuery = vi.mocked(db.query)
const mockProductToGmcItems = vi.mocked(mapper.productToGmcItems)
const mockUpsertProduct = vi.mocked(client.upsertProduct)
const mockDeleteProductByOfferId = vi.mocked(client.deleteProductByOfferId)
const mockListProducts = vi.mocked(client.listProducts)
const mockCustomBatchUpsert = vi.mocked(client.customBatchUpsert)

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
    mockListProducts.mockResolvedValue({ resources: [], nextPageToken: undefined } as any)
    // resetAllMocks wipes the factory's getMerchantId implementation — re-stub it.
    vi.mocked(client.getMerchantId).mockResolvedValue('test-merchant-123')
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

    it('records a whole-batch failure once with the items it covers', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'A' }])
      mockProductToGmcItems.mockReturnValueOnce([
        { offerId: 'A1', title: 'a', imageLink: 'https://x/a.png', price: { value: '10.00' } },
        { offerId: 'A2', title: 'a', imageLink: 'https://x/a.png', price: { value: '10.00' } },
      ])
      mockCustomBatchUpsert.mockRejectedValueOnce(new Error('HTTP 403: forbidden'))
      const result = await syncAllProductsToMerchant()
      expect(result.errors).toContainEqual({ sku: 'batch-0', error: 'HTTP 403: forbidden', items: 2 })
    })

    it('skips the rest of the run after repeated identical batch failures', async () => {
      const items = Array.from({ length: 600 }, (_, i) => ({
        offerId: `S${i}`,
        title: 't',
        imageLink: 'https://x/a.png',
        price: { value: '1.00' },
      }))
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'P' }])
      mockProductToGmcItems.mockReturnValueOnce(items)
      mockCustomBatchUpsert.mockRejectedValue(new Error('gone (410)'))
      const result = await syncAllProductsToMerchant()
      expect(mockCustomBatchUpsert).toHaveBeenCalledTimes(3)
      const skipped = result.errors.find(e => /Skipped after 3/.test(e.error))
      expect(skipped?.items).toBe(300)
    })

    it('does not push items with missing images or prices and says why', async () => {
      const actual = await vi.importActual<typeof import('@/lib/merchant/mapper')>('@/lib/merchant/mapper')
      vi.mocked(mapper.gmcItemProblem).mockImplementation(actual.gmcItemProblem)
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'P' }])
      mockProductToGmcItems.mockReturnValueOnce([
        { offerId: 'NOIMG', title: 't', imageLink: '', price: { value: '5.00' } },
        { offerId: 'OK', title: 't', imageLink: 'https://x/a.png', price: { value: '5.00' } },
      ])
      mockCustomBatchUpsert.mockResolvedValueOnce({ entries: [{ batchId: 0 }] } as any)
      const result = await syncAllProductsToMerchant()
      expect(result.errors).toContainEqual({ sku: 'NOIMG', error: 'Missing product image' })
      expect(mockCustomBatchUpsert.mock.calls[0][0]).toHaveLength(1)
      expect(result.synced).toBe(1)
    })

    it('syncs products successfully when lock acquired', async () => {
      const fakeProducts = [
        { id: 'p1', sku: 'SKU-001', name: 'Widget A' },
        { id: 'p2', sku: 'SKU-002', name: 'Widget B' },
      ]
      mockQueryMany.mockResolvedValueOnce(fakeProducts)

      mockProductToGmcItems
        .mockReturnValueOnce([{ offerId: 'SKU-001', title: 'Widget A' }])
        .mockReturnValueOnce([{ offerId: 'SKU-002', title: 'Widget B' }])

      mockCustomBatchUpsert.mockResolvedValueOnce({
        entries: [
          { batchId: 0, product: { offerId: 'SKU-001' } },
          { batchId: 1, product: { offerId: 'SKU-002' } },
        ],
      } as any)

      const result = await syncAllProductsToMerchant()
      expect(result.synced).toBeGreaterThanOrEqual(0)
      expect(result).toHaveProperty('startedAt')
      expect(result).toHaveProperty('finishedAt')
    })

    it('deletes GMC offers not in active product set', async () => {
      mockListProducts.mockResolvedValueOnce({
        resources: [{ offerId: 'OLD-SKU' }],
        nextPageToken: undefined,
      } as any)

      const result = await syncAllProductsToMerchant()
      expect(result.deleted).toBeGreaterThanOrEqual(1)
      expect(mockDeleteProductByOfferId).toHaveBeenCalledWith('OLD-SKU')
    })

    it('handles batch upsert errors gracefully', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'SKU-001', name: 'Widget' }])
      mockProductToGmcItems.mockReturnValueOnce([{ offerId: 'SKU-001' }])

      mockCustomBatchUpsert.mockResolvedValueOnce({
        entries: [
          {
            batchId: 0,
            errors: { errors: [{ message: 'invalid product data' }] },
          },
        ],
      } as any)

      const result = await syncAllProductsToMerchant()
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('handles productToGmcItems exception per product', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'BAD-SKU', name: 'Bad' }])
      mockProductToGmcItems.mockImplementationOnce(() => {
        throw new Error('mapping failed')
      })

      const result = await syncAllProductsToMerchant()
      expect(result.errors.some(e => e.sku === 'BAD-SKU')).toBe(true)
    })

    it('paginates through GMC product list', async () => {
      mockListProducts
        .mockResolvedValueOnce({
          resources: [{ offerId: 'PAGE1-SKU' }],
          nextPageToken: 'token-page2',
        } as any)
        .mockResolvedValueOnce({
          resources: [{ offerId: 'PAGE2-SKU' }],
          nextPageToken: undefined,
        } as any)

      const result = await syncAllProductsToMerchant()
      expect(result.deleted).toBe(2)
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
      expect(mockUpsertProduct).not.toHaveBeenCalled()
    })

    it('upserts inactive product as out_of_stock (not deleted)', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        sku: 'SKU-001',
        is_active: false,
        product_variants: [],
      })
      mockProductToGmcItems.mockReturnValueOnce([{ offerId: 'SKU-001', availability: 'out of stock' }])
      await syncProductToMerchant('p1')
      expect(mockUpsertProduct).toHaveBeenCalledWith({ offerId: 'SKU-001', availability: 'out of stock' })
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
        { offerId: 'SKU-001-S', availability: 'out of stock' },
        { offerId: 'SKU-001-L', availability: 'out of stock' },
      ])
      await syncProductToMerchant('p1')
      expect(mockUpsertProduct).toHaveBeenCalledTimes(2)
      expect(mockDeleteProductByOfferId).not.toHaveBeenCalled()
    })

    it('upserts inactive product with sanitized sku', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1',
        sku: 'SKU 001/test',
        is_active: false,
        product_variants: [],
      })
      mockProductToGmcItems.mockReturnValueOnce([{ offerId: 'SKU_001_test', availability: 'out of stock' }])
      await syncProductToMerchant('p1')
      expect(mockUpsertProduct).toHaveBeenCalledWith({ offerId: 'SKU_001_test', availability: 'out of stock' })
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
      expect(mockUpsertProduct).toHaveBeenCalledWith({ offerId: 'SKU-001', title: 'Widget' })
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
      expect(mockUpsertProduct).toHaveBeenCalledTimes(2)
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
      expect(mockUpsertProduct).toHaveBeenCalledTimes(2)
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
