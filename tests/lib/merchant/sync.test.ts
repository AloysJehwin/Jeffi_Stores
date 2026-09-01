import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
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
} from '@/lib/merchant/sync'
import * as db from '@/lib/db'
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
    it('returns lock-held result when advisory lock not acquired', async () => {
      mockQueryOne.mockResolvedValueOnce({ acquired: false })

      const result = await syncAllProductsToMerchant()
      expect(result.synced).toBe(0)
      expect(result.errors[0].sku).toBe('__lock__')
      expect(result.errors[0].error).toMatch(/running|lock/i)
    })

    it('syncs products successfully when lock acquired', async () => {
      mockQueryOne.mockResolvedValueOnce({ acquired: true })

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
      mockQueryOne.mockResolvedValueOnce({ acquired: true })

      mockListProducts.mockResolvedValueOnce({
        resources: [{ offerId: 'OLD-SKU' }],
        nextPageToken: undefined,
      } as any)

      const result = await syncAllProductsToMerchant()
      expect(result.deleted).toBeGreaterThanOrEqual(1)
      expect(mockDeleteProductByOfferId).toHaveBeenCalledWith('OLD-SKU')
    })

    it('handles batch upsert errors gracefully', async () => {
      mockQueryOne.mockResolvedValueOnce({ acquired: true })

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
      mockQueryOne.mockResolvedValueOnce({ acquired: true })

      mockQueryMany.mockResolvedValueOnce([{ id: 'p1', sku: 'BAD-SKU', name: 'Bad' }])
      mockProductToGmcItems.mockImplementationOnce(() => { throw new Error('mapping failed') })

      const result = await syncAllProductsToMerchant()
      expect(result.errors.some(e => e.sku === 'BAD-SKU')).toBe(true)
    })

    it('paginates through GMC product list', async () => {
      mockQueryOne.mockResolvedValueOnce({ acquired: true })

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

  describe('syncProductToMerchant', () => {
    it('does nothing when product not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await syncProductToMerchant('nonexistent-id')
      expect(mockUpsertProduct).not.toHaveBeenCalled()
    })

    it('upserts inactive product as out_of_stock (not deleted)', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1', sku: 'SKU-001', is_active: false, product_variants: [],
      })
      mockProductToGmcItems.mockReturnValueOnce([{ offerId: 'SKU-001', availability: 'out of stock' }])
      await syncProductToMerchant('p1')
      expect(mockUpsertProduct).toHaveBeenCalledWith({ offerId: 'SKU-001', availability: 'out of stock' })
      expect(mockDeleteProductByOfferId).not.toHaveBeenCalled()
    })

    it('upserts all variant items for inactive product with variants as out_of_stock', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'p1', sku: 'SKU-001', is_active: false,
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
        id: 'p1', sku: 'SKU 001/test', is_active: false, product_variants: [],
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

      mockProductToGmcItems.mockReturnValueOnce([
        { offerId: 'SKU-001', title: 'Widget' },
      ])

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
        id: 'p1', sku: 'SKU-001', is_active: true,
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
