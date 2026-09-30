import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — factories must NOT reference variables defined outside the factory
// because vi.mock() is hoisted to the top of the file.
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (_key: string) => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock('@/lib/shared/ai-feedback', () => ({
  recordImplicitSignal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

// Use vi.fn() with no default — each test sets its own return value via beforeEach
vi.mock('@/lib/orders/order-commit', () => ({
  resolveBuyNowItem: vi.fn(),
  loadActiveCart: vi.fn(),
}))

vi.mock('@/lib/orders/checkout-intent', () => ({
  signIntent: vi.fn(),
  verifyIntent: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import handlers AFTER mocks
// ---------------------------------------------------------------------------
import { POST } from '@/app/api/(public)/checkout/intents/route'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { resolveBuyNowItem, loadActiveCart } from '@/lib/orders/order-commit'
import { signIntent } from '@/lib/orders/checkout-intent'

const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440002'
const USER_ID = '550e8400-e29b-41d4-a716-446655440001'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/checkout/intents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/checkout/intents — buyNow mode', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue(null)
    vi.mocked(resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: {
        productId: PRODUCT_ID,
        variantId: null,
        subVariantId: null,
        qty: 2,
        buyMode: 'unit',
        buyUnit: null,
      },
    } as any)
    vi.mocked(signIntent).mockResolvedValue('mock-intent-token-xyz')
  })

  it('creates an intent token for a valid buyNow request', async () => {
    const req = makeRequest({ productId: PRODUCT_ID, qty: 2 })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('intent')
    expect(typeof body.intent).toBe('string')
    expect(body.intent).toBe('mock-intent-token-xyz')
  })

  it('returns 400 when productId is missing for buyNow', async () => {
    // Neither productId nor qty will be present — schema allows both optional,
    // but the route's own guard emits: "productId and qty required"
    const req = makeRequest({ qty: 1 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('productId and qty required')
  })

  it('returns 400 when qty is missing for buyNow', async () => {
    // productId present but qty absent — route guard fires
    const req = makeRequest({ productId: PRODUCT_ID })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('productId and qty required')
  })

  it('returns 400 when resolveBuyNowItem fails', async () => {
    vi.mocked(resolveBuyNowItem).mockResolvedValue({
      ok: false,
      error: 'Product out of stock',
    } as any)
    const req = makeRequest({ productId: PRODUCT_ID, qty: 1 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Product out of stock')
  })
})

describe('POST /api/checkout/intents — cart mode', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(loadActiveCart).mockResolvedValue([{ id: 'cart-item-1', product_id: PRODUCT_ID }] as any)
    vi.mocked(signIntent).mockResolvedValue('cart-intent-token-abc')
  })

  it('creates a cart intent token when user is authenticated with items', async () => {
    const req = makeRequest({ mode: 'cart' })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.intent).toBe('cart-intent-token-abc')
  })

  it('returns 401 when cart mode is requested but user is not authenticated', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue(null)
    const req = makeRequest({ mode: 'cart' })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 400 when cart is empty', async () => {
    vi.mocked(loadActiveCart).mockResolvedValue([])
    const req = makeRequest({ mode: 'cart' })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Cart is empty')
  })
})
