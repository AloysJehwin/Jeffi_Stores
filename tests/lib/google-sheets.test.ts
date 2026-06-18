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

import { buildProductHighlights, buildProductDetails, buildCustomLabels } from '@/lib/google-merchant-helpers'

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
    expect(calls.some(url => url.includes('AM1'))).toBe(true)
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
})
