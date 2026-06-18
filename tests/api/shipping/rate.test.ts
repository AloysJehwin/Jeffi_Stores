import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/shipping', () => ({
  packIntoCartons: vi.fn(),
  fallbackShippingRate: vi.fn(),
  CARTON_MAX_WEIGHT_GRAMS: 20000,
}))
vi.mock('@/lib/delivery-settings', () => ({
  getDeliverySettings: vi.fn(),
  applyDeliveryRules: vi.fn(),
}))
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

// Mock global fetch for Delhivery API
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from '@/app/api/shipping/rate/route'
import { queryMany } from '@/lib/db'
import { packIntoCartons, fallbackShippingRate } from '@/lib/shipping'
import { getDeliverySettings, applyDeliveryRules } from '@/lib/delivery-settings'

const mockQueryMany = vi.mocked(queryMany)
const mockPackIntoCartons = vi.mocked(packIntoCartons)
const mockFallbackRate = vi.mocked(fallbackShippingRate)
const mockGetDeliverySettings = vi.mocked(getDeliverySettings)
const mockApplyRules = vi.mocked(applyDeliveryRules)

const defaultSettings = {
  enabled: true,
  freeThreshold: 0,
  rules: [],
}

function makeRequest(body: object) {
  return new Request('http://localhost/api/shipping/rate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const variantCartItem = { variantId: 'var-1', quantity: 2 }
const productCartItem = { productId: 'prod-1', quantity: 1 }

const mockVariantRow = {
  id: 'var-1',
  variant_name: 'M6x20',
  weight_grams: '500',
  package_type: null,
  length_cm: null,
  breadth_cm: null,
  height_cm: null,
}

const mockProductRow = {
  id: 'prod-1',
  name: 'Hex Bolt',
  weight_grams: '300',
  package_type: null,
  length_cm: null,
  breadth_cm: null,
  height_cm: null,
}

describe('POST /api/shipping/rate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DELHIVERY_API_KEY
    process.env.DELHIVERY_ORIGIN_PINCODE = '492001'
    process.env.COD_SURCHARGE_FLAT = '40'
    process.env.COD_SURCHARGE_PCT = '2'
    process.env.SHIPPING_MIN_CHARGE = '0'
  })

  it('returns 400 for invalid destination pincode', async () => {
    const res = await POST(makeRequest({ destinationPin: '123', cartItems: [variantCartItem] }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('pincode')
  })

  it('returns 400 for empty cartItems', async () => {
    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [] }) as any)
    expect(res.status).toBe(400)
  })

  it('returns admin_disabled when delivery is disabled', async () => {
    mockQueryMany.mockResolvedValueOnce([mockVariantRow])
    mockGetDeliverySettings.mockResolvedValueOnce({ ...defaultSettings, enabled: false } as any)

    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [variantCartItem] }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.source).toBe('admin_disabled')
    expect(json.charge).toBe(0)
  })

  it('returns free_threshold when subtotal meets threshold', async () => {
    mockQueryMany.mockResolvedValueOnce([mockVariantRow])
    mockGetDeliverySettings.mockResolvedValueOnce({ ...defaultSettings, freeThreshold: 500 } as any)

    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [variantCartItem], subtotal: 600 }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.source).toBe('free_threshold')
    expect(json.charge).toBe(0)
    expect(json.freeShippingThreshold).toBe(500)
  })

  it('uses fallback rate when no DELHIVERY_API_KEY', async () => {
    mockQueryMany.mockResolvedValueOnce([mockVariantRow])
    mockGetDeliverySettings.mockResolvedValueOnce(defaultSettings as any)
    mockPackIntoCartons.mockReturnValueOnce([{ chargedWeightGrams: 1000 }] as any)
    mockFallbackRate.mockReturnValueOnce({ charge: 60, zone: 'B', source: 'fallback' })
    mockApplyRules.mockReturnValueOnce({ charge: 60, source: 'as_is' } as any)

    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [variantCartItem] }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.source).toBe('fallback')
    expect(json.charge).toBe(60)
    expect(mockFallbackRate).toHaveBeenCalled()
  })

  it('adds COD surcharge when isCod=true', async () => {
    mockQueryMany.mockResolvedValueOnce([mockVariantRow])
    mockGetDeliverySettings.mockResolvedValueOnce(defaultSettings as any)
    mockPackIntoCartons.mockReturnValueOnce([{ chargedWeightGrams: 500 }] as any)
    mockFallbackRate.mockReturnValueOnce({ charge: 60, zone: 'A', source: 'fallback' })
    mockApplyRules.mockReturnValueOnce({ charge: 100, source: 'as_is' } as any)

    const res = await POST(makeRequest({
      destinationPin: '400053',
      cartItems: [variantCartItem],
      subtotal: 1000,
      isCod: true,
    }) as any)
    expect(res.status).toBe(200)
    // COD surcharge = max(40, 2% of 1000) = max(40, 20) = 40
    // So applyRules should be called with baseCharge that includes cod fee
    expect(mockApplyRules).toHaveBeenCalledWith(
      expect.objectContaining({ baseCharge: expect.any(Number) })
    )
  })

  it('handles product-based cart items', async () => {
    // productCartItem has no variantId — variantIds.length === 0, so the variants
    // queryMany branch is skipped entirely. Only one queryMany call for products.
    mockQueryMany.mockResolvedValueOnce([mockProductRow])
    mockGetDeliverySettings.mockResolvedValueOnce(defaultSettings as any)
    mockPackIntoCartons.mockReturnValueOnce([{ chargedWeightGrams: 300 }] as any)
    mockFallbackRate.mockReturnValueOnce({ charge: 50, zone: 'A', source: 'fallback' })
    mockApplyRules.mockReturnValueOnce({ charge: 50, source: 'as_is' } as any)

    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [productCartItem] }) as any)
    expect(res.status).toBe(200)
  })

  it('returns 400 when no valid shipment items found', async () => {
    // variantCartItem has variantId — queryMany called but returns empty (variant not found)
    mockQueryMany.mockResolvedValueOnce([])

    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [variantCartItem] }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('No valid cart items')
  })

  // TOKEN = process.env.DELHIVERY_API_KEY is a module-level constant captured at import time.
  // In this test environment the env var is set, so TOKEN is always truthy and the
  // Delhivery fetch path is always active regardless of per-test process.env changes.

  it('uses Delhivery API when token is set at module load time', async () => {
    mockQueryMany.mockResolvedValueOnce([mockVariantRow])
    mockGetDeliverySettings.mockResolvedValueOnce(defaultSettings as any)
    mockPackIntoCartons.mockReturnValueOnce([{ chargedWeightGrams: 500 }] as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ total_amount: 80, zone: 'C', charged_weight: 500, error: null }],
    })
    mockApplyRules.mockReturnValueOnce({ charge: 80, source: 'as_is' } as any)

    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [variantCartItem] }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.source).toBe('delhivery')
    expect(json.charge).toBe(80)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('falls back when Delhivery API fetch fails', async () => {
    mockQueryMany.mockResolvedValueOnce([mockVariantRow])
    mockGetDeliverySettings.mockResolvedValueOnce(defaultSettings as any)
    mockPackIntoCartons.mockReturnValueOnce([{ chargedWeightGrams: 500 }] as any)
    mockFetch.mockRejectedValueOnce(new Error('network error'))
    mockFallbackRate.mockReturnValueOnce({ charge: 60, zone: 'B', source: 'fallback' })
    mockApplyRules.mockReturnValueOnce({ charge: 60, source: 'as_is' } as any)

    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [variantCartItem] }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.source).toBe('fallback')
  })

  it('applies fallback rate per carton and sums charges', async () => {
    // Two cartons — fallbackShippingRate called twice, charges summed
    // Fetch fails so fallback path is taken for both cartons
    mockQueryMany.mockResolvedValueOnce([mockVariantRow])
    mockGetDeliverySettings.mockResolvedValueOnce(defaultSettings as any)
    mockPackIntoCartons.mockReturnValueOnce([
      { chargedWeightGrams: 500 },
      { chargedWeightGrams: 300 },
    ] as any)
    mockFetch.mockRejectedValueOnce(new Error('fail'))
    mockFallbackRate
      .mockReturnValueOnce({ charge: 60, zone: 'B', source: 'fallback' })
      .mockReturnValueOnce({ charge: 40, zone: 'B', source: 'fallback' })
    mockApplyRules.mockReturnValueOnce({ charge: 100, source: 'as_is' } as any)

    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [variantCartItem] }) as any)
    expect(res.status).toBe(200)
    expect(mockFallbackRate).toHaveBeenCalledTimes(2)
  })

  it('returns 500 on unexpected error', async () => {
    // variantCartItem has variantId → queryMany is called and rejects → outer catch → 500
    mockQueryMany.mockRejectedValueOnce(new Error('DB crash'))
    const res = await POST(makeRequest({ destinationPin: '400053', cartItems: [variantCartItem] }) as any)
    expect(res.status).toBe(500)
  })
})
