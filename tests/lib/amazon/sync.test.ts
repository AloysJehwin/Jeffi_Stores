import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test' }),
    })),
  },
}))
vi.mock('@/lib/merchant/product-fetch', () => ({
  fetchAllActiveProducts: vi.fn(),
  fetchProduct: vi.fn(),
}))
vi.mock('@/lib/amazon/mapper', () => ({
  productToAmazonListings: vi.fn(),
  productToAmazonOfferListing: vi.fn(),
}))
vi.mock('@/lib/amazon/client', () => ({
  putListingsItem: vi.fn(),
  patchListingsItem: vi.fn(),
  validateListingsItem: vi.fn(),
  deleteListingsItem: vi.fn(),
  matchAsin: vi.fn(),
  AMAZON_PUSH_DISABLED: false,
  getSellerId: vi.fn().mockResolvedValue('SELLER-123'),
  getMarketplaceId: vi.fn().mockResolvedValue('A21TJRUUN4KGV'),
}))

import {
  syncAllProductsToAmazon,
  syncProductToAmazon,
  deleteProductFromAmazon,
  validateProductForAmazon,
  dryRunAmazonSync,
  getLastAmazonSyncStatus,
  sendAmazonSyncFailureEmail,
} from '@/lib/amazon/sync'
import * as db from '@/lib/db'
import * as fetchMod from '@/lib/merchant/product-fetch'
import * as mapper from '@/lib/amazon/mapper'
import * as client from '@/lib/amazon/client'

const mockQuery = vi.mocked(db.query)
const mockQueryOne = vi.mocked(db.queryOne)
const mockFetchAll = vi.mocked(fetchMod.fetchAllActiveProducts)
const mockFetchProduct = vi.mocked(fetchMod.fetchProduct)
const mockToListings = vi.mocked(mapper.productToAmazonListings)
const mockToOffer = vi.mocked(mapper.productToAmazonOfferListing)
const mockPut = vi.mocked(client.putListingsItem)
const mockPatch = vi.mocked(client.patchListingsItem)
const mockValidate = vi.mocked(client.validateListingsItem)
const mockDelete = vi.mocked(client.deleteListingsItem)
const mockMatchAsin = vi.mocked(client.matchAsin)
const mockGetSellerId = vi.mocked(client.getSellerId)
const mockGetMarketplaceId = vi.mocked(client.getMarketplaceId)

function createListing(over: any = {}): any {
  return {
    sku: 'SKU-1',
    productType: 'PRODUCT',
    requirements: 'LISTING_FULL',
    attributes: {},
    ...over,
  }
}

describe('amazon/sync', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetSellerId.mockResolvedValue('SELLER-123')
    mockGetMarketplaceId.mockResolvedValue('A21TJRUUN4KGV')
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryOne.mockResolvedValue({ acquired: true } as any)
    mockFetchAll.mockResolvedValue([] as any)
    mockToListings.mockReturnValue([])
    mockToOffer.mockImplementation((_p: any, asin: string) => createListing({ requirements: 'LISTING_OFFER_ONLY', attributes: { merchant_suggested_asin: [{ value: asin }] } }))
    mockPut.mockResolvedValue({} as any)
  })

  describe('syncAllProductsToAmazon', () => {
    it('returns lock-held result when advisory lock not acquired', async () => {
      mockQueryOne.mockResolvedValueOnce({ acquired: false })
      const result = await syncAllProductsToAmazon()
      expect(result.errors[0].sku).toBe('__lock__')
      expect(result.synced).toBe(0)
    })

    it('runs full sync with a full-create product (no variants, no asin)', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])

      const result = await syncAllProductsToAmazon()
      expect(result.synced).toBe(1)
      expect(result.errors).toHaveLength(0)
      // saveSyncStatus insert + advisory lock + unlock => query called
      expect(mockQuery).toHaveBeenCalled()
    })

    it('handles a resolveListings error per-product then records error', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'BAD-SKU', name: 'Bad', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockImplementationOnce(() => { throw new Error('mapping failed') })

      const result = await syncAllProductsToAmazon()
      expect(result.errors.some(e => e.sku === 'BAD-SKU' && /mapping failed/.test(e.error))).toBe(true)
    })

    it('records a put error into errors[]', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])
      mockPut.mockRejectedValueOnce(new Error('put boom'))

      const result = await syncAllProductsToAmazon()
      expect(result.synced).toBe(0)
      expect(result.errors.some(e => e.error === 'put boom')).toBe(true)
    })

    it('offer-only path: variant with trusted gtin asin, patches offer + persists asin', async () => {
      mockFetchAll.mockResolvedValueOnce([
        {
          id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: true,
          product_variants: [{ sku: 'V1', price: 10, asin: 'B00ASIN', asin_match: 'gtin' }],
        },
      ] as any)
      mockToOffer.mockReturnValueOnce(createListing({
        sku: 'V1',
        requirements: 'LISTING_OFFER_ONLY',
        attributes: {
          purchasable_offer: [{ x: 1 }],
          merchant_suggested_asin: [{ value: 'B00ASIN' }],
        },
      }))

      const result = await syncAllProductsToAmazon()
      expect(result.synced).toBe(1)
      expect(mockMatchAsin).not.toHaveBeenCalled()
      expect(mockPatch).toHaveBeenCalled()
      // persistListedAsin -> update product_variants
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE product_variants'), ['B00ASIN', 'V1'])
    })

    it('persistListedAsin falls back to products when no variant matched', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: false, asin: 'B00LISTED', asin_match: 'listed' },
      ] as any)
      mockToOffer.mockReturnValueOnce(createListing({
        sku: 'SKU-1',
        requirements: 'LISTING_OFFER_ONLY',
        attributes: { merchant_suggested_asin: [{ value: 'B00LISTED' }] },
      }))
      // First UPDATE (variants) returns rowCount 0 -> triggers products update
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('UPDATE product_variants')) return { rowCount: 0 } as any
        return { rows: [], rowCount: 1 } as any
      })

      const result = await syncAllProductsToAmazon()
      expect(result.synced).toBe(1)
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE products'), ['B00LISTED', 'SKU-1'])
    })

    it('variant with null price is skipped, falls back to full-create', async () => {
      mockFetchAll.mockResolvedValueOnce([
        {
          id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: true,
          product_variants: [{ sku: 'V1', price: null }],
        },
      ] as any)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])

      const result = await syncAllProductsToAmazon()
      expect(result.synced).toBe(1)
      expect(mockToOffer).not.toHaveBeenCalled()
    })

    it('variant matches asin via catalog search (safeMatchAsin returns match)', async () => {
      mockFetchAll.mockResolvedValueOnce([
        {
          id: 'p1', sku: 'SKU-1', name: 'Widget', brands: { name: 'Acme' }, has_variants: true,
          product_variants: [{ sku: 'V1', price: 10, gtin: '123', variant_name: 'Red' }],
        },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce({ asin: 'B00FOUND' } as any)

      const result = await syncAllProductsToAmazon()
      expect(result.synced).toBe(1)
      expect(mockToOffer).toHaveBeenCalled()
    })

    it('safeMatchAsin swallows matchAsin errors -> full create', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: false },
      ] as any)
      mockMatchAsin.mockRejectedValueOnce(new Error('rate limit'))
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])

      const result = await syncAllProductsToAmazon()
      expect(result.synced).toBe(1)
    })
  })

  describe('putWithBackoff retry on 429', () => {
    it('retries on 429 with retryAfter header then succeeds', async () => {
      vi.useFakeTimers()
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])
      const err429: any = new Error('rate limited'); err429.status = 429; err429.retryAfter = '0'
      mockPut.mockRejectedValueOnce(err429).mockResolvedValueOnce({} as any)

      const p = syncAllProductsToAmazon()
      await vi.runAllTimersAsync()
      const result = await p
      vi.useRealTimers()
      expect(result.synced).toBe(1)
      expect(mockPut).toHaveBeenCalledTimes(2)
    })

    it('gives up after MAX_RETRIES 429s and records error', async () => {
      vi.useFakeTimers()
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])
      const err429: any = new Error('always 429'); err429.status = 429
      mockPut.mockRejectedValue(err429)

      const p = syncAllProductsToAmazon()
      await vi.runAllTimersAsync()
      const result = await p
      vi.useRealTimers()
      expect(result.errors.some(e => e.error === 'always 429')).toBe(true)
    })

    it('non-429 error throws immediately (no retry)', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])
      const err: any = new Error('500 err'); err.status = 500
      mockPut.mockRejectedValueOnce(err)

      const result = await syncAllProductsToAmazon()
      expect(result.errors.some(e => e.error === '500 err')).toBe(true)
      expect(mockPut).toHaveBeenCalledTimes(1)
    })

    it('offer patch failure is swallowed', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'Widget', has_variants: false, asin: 'B0', asin_match: 'gtin' },
      ] as any)
      mockToOffer.mockReturnValueOnce(createListing({
        sku: 'SKU-1', requirements: 'LISTING_OFFER_ONLY',
        attributes: { purchasable_offer: [{}], merchant_suggested_asin: [{ value: 'B0' }] },
      }))
      mockPatch.mockRejectedValueOnce(new Error('patch fail'))

      const result = await syncAllProductsToAmazon()
      expect(result.synced).toBe(1)
    })
  })

  describe('syncProductToAmazon', () => {
    it('returns early when product not found', async () => {
      mockFetchProduct.mockResolvedValueOnce(null as any)
      await syncProductToAmazon('nope')
      expect(mockPut).not.toHaveBeenCalled()
    })

    it('puts each resolved listing', async () => {
      mockFetchProduct.mockResolvedValueOnce({ id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false } as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])
      await syncProductToAmazon('p1')
      expect(mockPut).toHaveBeenCalledWith('SKU-1', expect.any(Object))
    })
  })

  describe('deleteProductFromAmazon', () => {
    it('delegates to deleteListingsItem', async () => {
      await deleteProductFromAmazon('SKU-9')
      expect(mockDelete).toHaveBeenCalledWith('SKU-9')
    })
  })

  describe('validateProductForAmazon', () => {
    it('returns notfound row when product missing', async () => {
      mockFetchProduct.mockResolvedValueOnce(null as any)
      const out = await validateProductForAmazon('x')
      expect(out[0].sku).toBe('__notfound__')
    })

    it('returns per-sku validation result', async () => {
      mockFetchProduct.mockResolvedValueOnce({ id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false } as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1', productType: 'PT', requirements: 'LISTING_FULL' })])
      mockValidate.mockResolvedValueOnce({ status: 'VALID', issues: [] } as any)
      const out = await validateProductForAmazon('p1')
      expect(out[0]).toMatchObject({ sku: 'SKU-1', productType: 'PT', status: 'VALID' })
    })

    it('captures validate error into row', async () => {
      mockFetchProduct.mockResolvedValueOnce({ id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false } as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1', productType: 'PT', requirements: 'LISTING_FULL' })])
      mockValidate.mockRejectedValueOnce(new Error('validate boom'))
      const out = await validateProductForAmazon('p1')
      expect(out[0].error).toBe('validate boom')
    })
  })

  describe('dryRunAmazonSync', () => {
    it('reports offer-only postable row', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'W', brands: { name: 'Acme' }, has_variants: false, asin: 'B0', asin_match: 'gtin' },
      ] as any)
      mockToOffer.mockReturnValueOnce(createListing({
        sku: 'SKU-1', requirements: 'LISTING_OFFER_ONLY',
        attributes: { merchant_suggested_asin: [{ value: 'B0' }] },
      }))
      mockValidate.mockResolvedValueOnce({ status: 'VALID', issues: [] } as any)

      const rep = await dryRunAmazonSync(10)
      expect(rep.scanned).toBe(1)
      expect(rep.offerOnly).toBe(1)
      expect(rep.postable).toBe(1)
      expect(rep.rows[0].strategy).toBe('offer-only')
      expect(rep.rows[0].postable).toBe(true)
    })

    it('reports blocked create row with block reason from issues', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])
      mockValidate.mockResolvedValueOnce({ status: 'INVALID', issues: [{ code: 'E1', message: 'bad thing' }] } as any)

      const rep = await dryRunAmazonSync()
      expect(rep.create).toBe(1)
      expect(rep.blocked).toBe(1)
      expect(rep.rows[0].postable).toBe(false)
      expect(rep.rows[0].blockReason).toContain('E1')
    })

    it('block reason defaults to "invalid" when no issues', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])
      mockValidate.mockResolvedValueOnce({ status: 'INVALID', issues: [] } as any)

      const rep = await dryRunAmazonSync()
      expect(rep.rows[0].blockReason).toBe('invalid')
    })

    it('validate throwing sets postable null + blockReason from message', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([createListing({ sku: 'SKU-1' })])
      mockValidate.mockRejectedValueOnce(new Error('network down'))

      const rep = await dryRunAmazonSync()
      expect(rep.rows[0].postable).toBeNull()
      expect(rep.rows[0].blockReason).toBe('network down')
    })

    it('resolveListings throwing produces a create/blocked row', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockImplementationOnce(() => { throw new Error('resolve boom') })

      const rep = await dryRunAmazonSync()
      expect(rep.rows[0].strategy).toBe('create')
      expect(rep.rows[0].blockReason).toBe('resolve boom')
    })

    it('no listing (empty) leaves postable null', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValueOnce(null)
      mockToListings.mockReturnValueOnce([])

      const rep = await dryRunAmazonSync()
      expect(rep.rows[0].postable).toBeNull()
      expect(mockValidate).not.toHaveBeenCalled()
    })

    it('truncated true when products exceed slice limit', async () => {
      mockFetchAll.mockResolvedValueOnce([
        { id: 'p1', sku: 'SKU-1', name: 'W', has_variants: false },
        { id: 'p2', sku: 'SKU-2', name: 'W2', has_variants: false },
      ] as any)
      mockMatchAsin.mockResolvedValue(null)
      mockToListings.mockReturnValue([])

      const rep = await dryRunAmazonSync(1)
      expect(rep.truncated).toBe(true)
      expect(rep.scanned).toBe(1)
    })
  })

  describe('getLastAmazonSyncStatus', () => {
    it('returns last log entry', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 1, status: 'success' })
      const r = await getLastAmazonSyncStatus()
      expect(r).toMatchObject({ status: 'success' })
    })

    it('returns null on db error', async () => {
      mockQueryOne.mockRejectedValueOnce(new Error('db down'))
      const r = await getLastAmazonSyncStatus()
      expect(r).toBeNull()
    })
  })

  describe('sendAmazonSyncFailureEmail', () => {
    const result: any = {
      synced: 1, deleted: 0,
      errors: [{ sku: 'SKU-1', error: 'boom' }],
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    }

    it('sends without throwing', async () => {
      await expect(sendAmazonSyncFailureEmail(result)).resolves.not.toThrow()
    })

    it('truncates when more than 20 errors', async () => {
      const errors = Array.from({ length: 25 }, (_, i) => ({ sku: `S${i}`, error: `e${i}` }))
      await expect(sendAmazonSyncFailureEmail({ ...result, errors })).resolves.not.toThrow()
    })
  })
})
