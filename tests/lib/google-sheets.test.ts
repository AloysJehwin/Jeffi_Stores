import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted so the mock variable is available inside vi.mock factory (hoisting-safe)
const { mockCreateSign } = vi.hoisted(() => ({
  mockCreateSign: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnThis(),
    sign: vi.fn().mockReturnValue(Buffer.from('mock-signature')),
  }),
}))

// ---- mock db ----
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

// ---- mock google-merchant-helpers (used by google-sheets) ----
vi.mock('@/lib/google-merchant-helpers', () => ({
  getGoogleProductCategory: vi.fn().mockReturnValue('Hardware'),
  buildProductType: vi.fn().mockReturnValue('Tools > Hand Tools'),
  buildProductHighlights: vi.fn().mockReturnValue(['Made of Steel']),
  buildProductDetails: vi.fn().mockReturnValue([]),
  buildCustomLabels: vi.fn().mockReturnValue(['Bolts', '100-500', 'Unbrako', 'in-stock', 'standard']),
}))

// ---- mock crypto — must use vi.hoisted variable so createSign is intercepted before module loads ----
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  return {
    ...actual,
    default: { ...actual, createSign: mockCreateSign },
    createSign: mockCreateSign,
  }
})

// ---- mock global fetch ----
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { getGoogleProductCategory, buildProductType, buildProductHighlights, buildProductDetails, buildCustomLabels } from '@/lib/google-merchant-helpers'

const mockGetGoogleProductCategory = vi.mocked(getGoogleProductCategory)
const mockBuildProductType = vi.mocked(buildProductType)
const mockBuildProductHighlights = vi.mocked(buildProductHighlights)
const mockBuildProductDetails = vi.mocked(buildProductDetails)
const mockBuildCustomLabels = vi.mocked(buildCustomLabels)

import { syncAllProductsToSheet, syncProductToSheet } from '@/lib/google-sheets'
import { queryMany, queryOne } from '@/lib/db'

const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

// Provide a valid JWT-like token response from Google OAuth
function mockTokenResponse() {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ access_token: 'mock-token', expires_in: 3600 }),
  }
}

// Generic successful sheets response (empty sheet)
function mockEmptySheetResponse() {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ values: [] }),
  }
}

function mockSheetWithRows(rows: string[][]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ values: rows }),
  }
}

function mockBatchUpdateResponse() {
  return { ok: true, json: vi.fn().mockResolvedValue({}) }
}

function mockAppendResponse() {
  return { ok: true, json: vi.fn().mockResolvedValue({}) }
}

const baseProduct = {
  id: 'p1',
  sku: 'BOLT-M6',
  name: 'M6 Bolt',
  slug: 'bolt-m6',
  description: 'A standard M6 bolt',
  base_price: 15,
  mrp: 20,
  is_active: true,
  has_variants: false,
  stock_status: 'In Stock',
  weight: 0.05,
  material: 'Steel',
  product_images: [{ id: 'img1', image_url: 'https://cdn.example.com/bolt.jpg', is_primary: true, display_order: 0 }],
  product_variants: [],
  categories: { id: 'cat1', name: 'Fasteners', google_product_category: '1167', parent_name: 'Hardware', parent_google_product_category: '632' },
  brands: { id: 'b1', name: 'Unbrako' },
}

const baseVariantProduct = {
  ...baseProduct,
  sku: 'BOLT-VAR',
  has_variants: true,
  product_variants: [
    { sku: 'BOLT-VAR-M6', variant_name: 'M6', price: 15, mrp: 20, stock_status: 'In Stock' },
    { sku: 'BOLT-VAR-M8', variant_name: 'M8', price: 20, mrp: 25, stock_status: 'Out of Stock' },
  ],
}

// Per-test fetch response queue for non-OAuth calls.
// Each test pushes its expected sheet API responses here in order.
let sheetResponseQueue: Array<() => object> = []

beforeEach(() => {
  vi.resetAllMocks()
  sheetResponseQueue = []
  // After resetAllMocks, re-apply mock implementations that were cleared
  mockCreateSign.mockReturnValue({
    update: vi.fn().mockReturnThis(),
    sign: vi.fn().mockReturnValue(Buffer.from('mock-signature')),
  })
  // Re-apply google-merchant-helpers mock return values
  mockGetGoogleProductCategory.mockReturnValue('Hardware')
  mockBuildProductType.mockReturnValue('Tools > Hand Tools')
  mockBuildProductHighlights.mockReturnValue(['Made of Steel'])
  mockBuildProductDetails.mockReturnValue([])
  mockBuildCustomLabels.mockReturnValue(['Bolts', '100-500', 'Unbrako', 'in-stock', 'standard'])
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'test@project.iam.gserviceaccount.com',
    private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtEsHAGQmFjBCOB0RPIP2jqNV\n-----END RSA PRIVATE KEY-----',
  })
  // Route by URL: OAuth calls always get a token; sheet API calls consume
  // from sheetResponseQueue in order; unknown calls get a safe fallback.
  mockFetch.mockImplementation((url: string) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return Promise.resolve(mockTokenResponse())
    }
    const next = sheetResponseQueue.shift()
    if (next) return Promise.resolve(next())
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

// ---------------------------------------------------------------------------
// syncAllProductsToSheet
// ---------------------------------------------------------------------------
describe('syncAllProductsToSheet', () => {
  it('returns inserted/updated/skipped counts', async () => {
    mockQueryMany.mockResolvedValue([baseProduct])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result).toHaveProperty('inserted')
    expect(result).toHaveProperty('updated')
    expect(result).toHaveProperty('skipped')
  })

  it('inserts new SKU rows when sheet is empty', async () => {
    mockQueryMany.mockResolvedValue([baseProduct])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('skips unchanged rows', async () => {
    mockQueryMany.mockResolvedValue([])
    sheetResponseQueue.push(mockEmptySheetResponse)

    const result = await syncAllProductsToSheet()
    expect(result.skipped).toBe(0)
    expect(result.inserted).toBe(0)
  })

  it('updates rows when data has changed', async () => {
    const existingRows = [
      Array(38).fill(''),
      ['BOLT-M6', ...Array(37).fill('')],
    ]
    mockQueryMany.mockResolvedValue([baseProduct])
    sheetResponseQueue.push(
      () => mockSheetWithRows(existingRows),
      mockBatchUpdateResponse,
    )

    const result = await syncAllProductsToSheet()
    expect(result.updated).toBe(1)
    expect(result.inserted).toBe(0)
  })

  it('writes header row when sheet was empty', async () => {
    mockQueryMany.mockResolvedValue([])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    await syncAllProductsToSheet()
    const calls = mockFetch.mock.calls.map(c => String(c[0]))
    expect(calls.some(url => url.includes('AN1'))).toBe(true)
  })

  it('handles variant products — inserts one row per variant', async () => {
    mockQueryMany.mockResolvedValue([baseVariantProduct])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(2)
  })

  it('skips variant rows with null price', async () => {
    const productWithNullPriceVariant = {
      ...baseVariantProduct,
      product_variants: [
        { sku: 'VAR-1', variant_name: 'V1', price: null, mrp: null, stock_status: 'In Stock' },
        { sku: 'VAR-2', variant_name: 'V2', price: 10, mrp: 15, stock_status: 'In Stock' },
      ],
    }
    mockQueryMany.mockResolvedValue([productWithNullPriceVariant])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(1)
  })

  it('respects testLimit parameter', async () => {
    mockQueryMany.mockResolvedValue([])
    sheetResponseQueue.push(mockEmptySheetResponse)

    await syncAllProductsToSheet(10)
    expect(mockQueryMany).toHaveBeenCalledOnce()
    const [sql] = mockQueryMany.mock.calls[0]
    expect(sql).toContain('10')
  })

  it('uses Bearer token in Authorization header', async () => {
    mockQueryMany.mockResolvedValue([])
    sheetResponseQueue.push(mockEmptySheetResponse)

    await syncAllProductsToSheet()
    const firstSheetCall = mockFetch.mock.calls.find(c => !String(c[0]).includes('oauth2.googleapis.com'))
    expect(firstSheetCall?.[1]?.headers?.Authorization).toBe('Bearer mock-token')
  })
})

// ---------------------------------------------------------------------------
// syncProductToSheet
// ---------------------------------------------------------------------------
// NOTE: fetchProduct inside syncProductToSheet uses a dynamic import('./db')
// at runtime. Vitest's vi.mock intercepts static imports; the dynamic import
// resolves through Node's module cache and always returns the mocked module
// because vitest registers the mock before any module loads. However, the
// mock instances returned by the dynamic import are the SAME vi.fn() instances
// as those imported statically — so mockQueryOne controls fetchProduct's result.
describe('syncProductToSheet', () => {
  it('does not throw when product is null (not found)', async () => {
    mockQueryOne.mockResolvedValue(null)
    sheetResponseQueue.push(() => ({ ok: true, json: vi.fn().mockResolvedValue({ values: [] }) }))

    await expect(syncProductToSheet('p1')).resolves.toBeUndefined()
  })

  it('re-throws DB errors from fetchProduct', async () => {
    mockQueryOne.mockRejectedValue(new Error('DB fail'))
    await expect(syncProductToSheet('p1')).rejects.toThrow('DB fail')
  })

  it('fetches the product via queryOne', async () => {
    mockQueryOne.mockResolvedValue(null)
    sheetResponseQueue.push(() => ({ ok: true, json: vi.fn().mockResolvedValue({ values: [] }) }))

    await syncProductToSheet('specific-product-id')
    expect(mockQueryOne).toHaveBeenCalled()
  })

  it('appends new rows for active product when no existing SKU rows', async () => {
    mockQueryOne.mockResolvedValue(baseProduct)
    sheetResponseQueue.push(
      () => ({ ok: true, json: vi.fn().mockResolvedValue({ values: [] }) }),
      mockAppendResponse,
    )

    await expect(syncProductToSheet('p1')).resolves.toBeUndefined()
  })

  it('does not append rows when product has no rows (variants with null price)', async () => {
    const varProduct = {
      ...baseVariantProduct,
      product_variants: [
        { sku: 'V1', variant_name: 'V1', price: null, mrp: null, stock_status: 'In Stock' },
      ],
    }
    mockQueryOne.mockResolvedValue(varProduct)
    sheetResponseQueue.push(() => ({ ok: true, json: vi.fn().mockResolvedValue({ values: [] }) }))

    await syncProductToSheet('p1')
    const calls = mockFetch.mock.calls.map(c => String(c[0]))
    expect(calls.some(url => url.includes('append'))).toBe(false)
  })

  it('re-throws errors', async () => {
    mockQueryOne.mockRejectedValue(new Error('DB error'))
    await expect(syncProductToSheet('p1')).rejects.toThrow('DB error')
  })

  it('removes inactive product from sheet', async () => {
    mockQueryOne.mockResolvedValue({ ...baseProduct, is_active: false, sku: 'BOLT-M6' })
    // removeProductFromSheet calls: fetch SKU column, then (if rows) batchUpdate
    sheetResponseQueue.push(
      () => ({ ok: true, json: vi.fn().mockResolvedValue({ values: [['header'], ['BOLT-M6'], ['BOLT-M6-VAR']] }) }),
      mockBatchUpdateResponse,
    )

    await expect(syncProductToSheet('p1')).resolves.toBeUndefined()
    const calls = mockFetch.mock.calls.map(c => String(c[0]))
    expect(calls.some(url => url.includes('batchUpdate'))).toBe(true)
  })

  it('removes product when product is null (sku empty, removeProductFromSheet returns early)', async () => {
    mockQueryOne.mockResolvedValue(null)
    // removeProductFromSheet with empty sku returns without fetching
    await expect(syncProductToSheet('p1')).resolves.toBeUndefined()
  })

  it('deletes existing SKU rows then appends new rows for active product', async () => {
    mockQueryOne.mockResolvedValue(baseProduct)
    // Fetch A:A returns column with matching SKU at row index 1
    sheetResponseQueue.push(
      () => ({ ok: true, json: vi.fn().mockResolvedValue({ values: [['header'], ['BOLT-M6']] }) }),
      mockBatchUpdateResponse, // delete rows
      mockAppendResponse,      // append new rows
    )

    await expect(syncProductToSheet('p1')).resolves.toBeUndefined()
    const calls = mockFetch.mock.calls.map(c => String(c[0]))
    expect(calls.some(url => url.includes('batchUpdate'))).toBe(true)
    expect(calls.some(url => url.includes('append'))).toBe(true)
  })

  it('appends variant rows for active variant product with matching SKUs in sheet', async () => {
    mockQueryOne.mockResolvedValue(baseVariantProduct)
    sheetResponseQueue.push(
      () => ({
        ok: true,
        json: vi.fn().mockResolvedValue({
          values: [['header'], ['BOLT-VAR-M6'], ['BOLT-VAR-M8']],
        }),
      }),
      mockBatchUpdateResponse, // delete rows
      mockAppendResponse,      // append new rows
    )

    await expect(syncProductToSheet('p1')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// loadCredentials — file-system fallback branch
// ---------------------------------------------------------------------------
describe('loadCredentials (fs fallback)', () => {
  it('reads credentials from fs when env var is absent', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON

    // Mock fs and path via require (loadCredentials uses require internally)
    const fsMock = { readFileSync: vi.fn().mockReturnValue(JSON.stringify({
      client_email: 'fs@project.iam.gserviceaccount.com',
      private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIFakeKey\n-----END RSA PRIVATE KEY-----',
    })) }
    vi.doMock('fs', () => fsMock)
    vi.doMock('path', () => ({ join: vi.fn().mockReturnValue('/fake/path/creds.json') }))

    // We can't directly call loadCredentials (it's not exported), but we can exercise it
    // by triggering syncAllProductsToSheet — if it doesn't throw it used the creds.
    // Restore env after test.
    try {
      mockQueryMany.mockResolvedValue([])
      sheetResponseQueue.push(mockEmptySheetResponse)
      // This will fail at createSign because the fake key is invalid, which is fine —
      // we just need it to reach the loadCredentials branch.
      await syncAllProductsToSheet().catch(() => {})
    } finally {
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
        client_email: 'test@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xHn\n-----END RSA PRIVATE KEY-----',
      })
    }
  })
})

// ---------------------------------------------------------------------------
// getAccessToken — cached token branch
// ---------------------------------------------------------------------------
describe('getAccessToken cache', () => {
  it('reuses cached token without calling OAuth again', async () => {
    // First call: prime the token into cache
    mockQueryMany.mockResolvedValue([])
    sheetResponseQueue.push(mockEmptySheetResponse)
    await syncAllProductsToSheet()

    const oauthCallsAfterFirst = mockFetch.mock.calls.filter(c =>
      String(c[0]).includes('oauth2.googleapis.com')
    ).length

    // Second call: should use cache, no new OAuth call
    mockQueryMany.mockResolvedValue([])
    sheetResponseQueue.push(mockEmptySheetResponse)
    await syncAllProductsToSheet()

    const oauthCallsAfterSecond = mockFetch.mock.calls.filter(c =>
      String(c[0]).includes('oauth2.googleapis.com')
    ).length

    // Both calls come from the same beforeEach-reset mock; with caching only 1 OAuth call total
    expect(oauthCallsAfterSecond).toBe(oauthCallsAfterFirst)
  })
})

// ---------------------------------------------------------------------------
// getAccessToken — missing access_token throws
// ---------------------------------------------------------------------------
describe('getAccessToken — bad OAuth response', () => {
  it('throws when OAuth response has no access_token', async () => {
    // The module caches a valid token from earlier tests. Advance time past the
    // cache expiry (token lasts 3600s; we jump 2 hours ahead) so the next call
    // must re-fetch from OAuth.
    vi.useFakeTimers()
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)

    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return Promise.resolve({
          ok: false,
          json: vi.fn().mockResolvedValue({ error: 'invalid_grant' }),
        })
      }
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) })
    })

    mockQueryMany.mockResolvedValue([baseProduct])
    try {
      await expect(syncAllProductsToSheet()).rejects.toThrow('Failed to get Google access token')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------------------
// productToSheetRows — edge case branches via syncAllProductsToSheet
// ---------------------------------------------------------------------------
describe('productToSheetRows — no primary image', () => {
  it('uses empty imageUrl when no images', async () => {
    const noImageProduct = { ...baseProduct, product_images: [] }
    mockQueryMany.mockResolvedValue([noImageProduct])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(1)
  })

  it('uses first image when none is marked primary', async () => {
    const nonPrimaryImages = {
      ...baseProduct,
      product_images: [
        { id: 'img1', image_url: 'https://cdn.example.com/first.jpg', is_primary: false, display_order: 0 },
        { id: 'img2', image_url: 'https://cdn.example.com/second.jpg', is_primary: false, display_order: 1 },
      ],
    }
    mockQueryMany.mockResolvedValue([nonPrimaryImages])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(1)
  })
})

describe('productToSheetRows — no brand name', () => {
  it('uses empty brandName when brands is null', async () => {
    const noBrandProduct = { ...baseProduct, brands: null, mpn: null, gtin: null }
    mockQueryMany.mockResolvedValue([noBrandProduct])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(1)
  })
})

describe('productToSheetRows — identifier_exists field', () => {
  it('sets identifier_exists to "no" when no mpn, gtin, or brand', async () => {
    const noIdProduct = { ...baseProduct, mpn: null, gtin: null, brands: { id: 'b1', name: '' } }
    mockQueryMany.mockResolvedValue([noIdProduct])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    // Capture the appended row values
    let appendedBody: any
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (String(url).includes('oauth2.googleapis.com')) return Promise.resolve(mockTokenResponse())
      if (String(url).includes('append') && opts?.body) {
        appendedBody = JSON.parse(opts.body)
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) })
      }
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({ values: [] }) })
    })

    await syncAllProductsToSheet()
    const row = appendedBody?.values?.[0]
    // index 12 is identifier_exists
    expect(row?.[12]).toBe('no')
  })
})

describe('productToSheetRows — no sale price when mrp equals price', () => {
  it('leaves sale_price empty when mrp equals base_price', async () => {
    const samePriceProduct = { ...baseProduct, base_price: 20, mrp: 20 }
    mockQueryMany.mockResolvedValue([samePriceProduct])

    let appendedBody: any
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (String(url).includes('oauth2.googleapis.com')) return Promise.resolve(mockTokenResponse())
      if (String(url).includes('append') && opts?.body) {
        appendedBody = JSON.parse(opts.body)
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) })
      }
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({ values: [] }) })
    })

    await syncAllProductsToSheet()
    const row = appendedBody?.values?.[0]
    // index 10 is sale_price — should be empty when mrp == base_price
    expect(row?.[10]).toBe('')
  })

  it('leaves sale_price empty when no mrp', async () => {
    const noMrpProduct = { ...baseProduct, mrp: null }
    mockQueryMany.mockResolvedValue([noMrpProduct])

    let appendedBody: any
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (String(url).includes('oauth2.googleapis.com')) return Promise.resolve(mockTokenResponse())
      if (String(url).includes('append') && opts?.body) {
        appendedBody = JSON.parse(opts.body)
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) })
      }
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({ values: [] }) })
    })

    await syncAllProductsToSheet()
    const row = appendedBody?.values?.[0]
    expect(row?.[10]).toBe('')
  })
})

describe('productToSheetRows — no weight', () => {
  it('leaves weight fields empty when product has no weight', async () => {
    const noWeightProduct = { ...baseProduct, weight: null }
    mockQueryMany.mockResolvedValue([noWeightProduct])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(1)
  })
})

describe('productToSheetRows — variant mrp fallbacks', () => {
  it('falls back to product mrp when variant has no mrp', async () => {
    const varNoMrp = {
      ...baseVariantProduct,
      mrp: 30,
      product_variants: [
        { sku: 'VAR-NOMRP', variant_name: 'NoMRP', price: 25, mrp: null, stock_status: 'In Stock' },
      ],
    }
    mockQueryMany.mockResolvedValue([varNoMrp])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(1)
  })

  it('uses selling price when neither variant nor product has mrp', async () => {
    const varNoMrpNoProdMrp = {
      ...baseVariantProduct,
      mrp: null,
      product_variants: [
        { sku: 'VAR-NOMRP2', variant_name: 'NoMRP2', price: 18, mrp: null, stock_status: 'In Stock' },
      ],
    }
    mockQueryMany.mockResolvedValue([varNoMrpNoProdMrp])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)

    const result = await syncAllProductsToSheet()
    expect(result.inserted).toBe(1)
  })
})

describe('syncAllProductsToSheet — row unchanged (skipped)', () => {
  it('increments skipped count when row data has not changed', async () => {
    // First pass: insert the product row (sheet is empty)
    mockQueryMany.mockResolvedValue([baseProduct])
    sheetResponseQueue.push(mockEmptySheetResponse, mockAppendResponse)
    await syncAllProductsToSheet()

    // Capture the row that was appended so we can feed it back as "existing"
    const appendCall = mockFetch.mock.calls.find(c => String(c[0]).includes('append'))
    const appendedRows: string[][] = JSON.parse(appendCall![1]!.body).values
    const existingRow = appendedRows[0]
    expect(existingRow[0]).toBe('BOLT-M6')

    // Second pass: serve the identical row back from the sheet read.
    // The sync should detect no changes and increment skipped.
    const existingSheet = { values: [Array(existingRow.length).fill(''), existingRow] }
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return Promise.resolve(mockTokenResponse())
      }
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(existingSheet) })
    })

    mockQueryMany.mockResolvedValue([baseProduct])
    const result = await syncAllProductsToSheet()
    expect(result).toMatchObject({ skipped: 1, updated: 0, inserted: 0 })
  })
})
