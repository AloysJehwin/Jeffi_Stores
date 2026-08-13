import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — ALL variables used inside vi.mock() factories must be defined
// inside the factory itself (factories are hoisted above const declarations).
// Expose the spies via vi.mocked() after import instead.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (_key: string) => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock('@/lib/ai-feedback', () => ({
  recordImplicitSignal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/guest-user', () => ({
  getUserIdForSession: vi.fn().mockResolvedValue('guest-user-uuid'),
}))

// wishlist/route.ts imports these SQL snippet constants
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: `(SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id)`,
  VARIANT_MIN_PRICE_INCL_GST_SQL: `(SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id)`,
  VARIANT_MIN_PRICE_EX_GST_SQL: `(SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id)`,
  VARIANT_MIN_MRP_SQL: `(SELECT MIN(pv.mrp) FROM product_variants pv WHERE pv.product_id = p.id)`,
  VARIANT_STOCK_TOTAL_SQL: `(SELECT COALESCE(SUM(pv.inventory_quantity),0) FROM product_variants pv WHERE pv.product_id = p.id)`,
}))
vi.mock('@/lib/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({
    razorpayEnabled: false,
    gstEnabled: false,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  }),
}))

// ---------------------------------------------------------------------------
// Import handlers AFTER mocks
// ---------------------------------------------------------------------------
import { GET, POST, DELETE } from '@/app/api/wishlist/route'
import { authenticateAnyUser } from '@/lib/jwt'
import { query, queryOne, queryMany } from '@/lib/db'

const USER_ID = '550e8400-e29b-41d4-a716-446655440001'
const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440002'

function makeRequest(method: string, url: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/wishlist', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
  })

  it('returns wishlist items for the user', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'wi-1', product_id: PRODUCT_ID, products: { id: PRODUCT_ID, name: 'Bolt Set' } },
    ])
    const req = makeRequest('GET', 'http://localhost/api/wishlist')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('items')
    expect(body.items).toHaveLength(1)
    expect(body.items[0].product_id).toBe(PRODUCT_ID)
  })

  it('returns empty items array when wishlist is empty', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    const req = makeRequest('GET', 'http://localhost/api/wishlist')
    const res = await GET(req as any)
    const body = await res.json()
    expect(body.items).toEqual([])
  })
})

describe('POST /api/wishlist — add item', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    // No existing wishlist entry
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(queryOne).mockResolvedValue({ name: 'Bolt Set' } as any)
  })

  it('adds a new item and returns 200 "Item added to wishlist"', async () => {
    const req = makeRequest('POST', 'http://localhost/api/wishlist', {
      productId: PRODUCT_ID,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item added to wishlist')
  })

  it('also accepts product_id field (snake_case alias)', async () => {
    const req = makeRequest('POST', 'http://localhost/api/wishlist', {
      product_id: PRODUCT_ID,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item added to wishlist')
  })

  it('returns idempotent message when item already in wishlist', async () => {
    // Simulate existing row returned by the SELECT check
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 'wi-existing' }], rowCount: 1 } as any)
    const req = makeRequest('POST', 'http://localhost/api/wishlist', {
      productId: PRODUCT_ID,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item already in wishlist')
  })

  it('returns 400 when productId is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/wishlist', {})
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })
})

describe('DELETE /api/wishlist', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
    vi.mocked(queryOne).mockResolvedValue({ name: 'Bolt Set' } as any)
  })

  it('removes item and returns 200 "Item removed from wishlist"', async () => {
    const req = makeRequest(
      'DELETE',
      `http://localhost/api/wishlist?productId=${PRODUCT_ID}`,
    )
    const res = await DELETE(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item removed from wishlist')
  })

  it('also accepts product_id query param (snake_case)', async () => {
    const req = makeRequest(
      'DELETE',
      `http://localhost/api/wishlist?product_id=${PRODUCT_ID}`,
    )
    const res = await DELETE(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item removed from wishlist')
  })
})
