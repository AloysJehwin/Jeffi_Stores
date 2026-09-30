import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — no top-level variables referenced inside vi.mock() factories
// (factories are hoisted above const declarations by Vitest/Babel).
// Access spies via vi.mocked() after the imports below.
// ---------------------------------------------------------------------------

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/auth/jwt', () => ({
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

vi.mock('@/lib/shared/ai-feedback', () => ({
  recordImplicitSignal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Import handlers AFTER mocks
// ---------------------------------------------------------------------------
import { POST } from '@/app/api/coupons/apply/route'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'

const USER_ID = '550e8400-e29b-41d4-a716-446655440001'
const COUPON_ID = '550e8400-e29b-41d4-a716-446655440099'

// A "perfect" coupon that passes every check
function makeCoupon(overrides: Record<string, unknown> = {}) {
  return {
    id: COUPON_ID,
    code: 'SAVE10',
    description: '10% off',
    discount_type: 'percentage',
    discount_value: 10,
    min_purchase_amount: null,
    max_discount_amount: null,
    usage_limit: null,
    usage_limit_per_user: null,
    times_used: 0,
    valid_from: null,
    valid_until: null,
    is_active: true,
    generated_for_user_id: null,
    ...overrides,
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/coupons/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Helper: configure queryOne call sequence for the coupon apply path.
// Call order: 1) coupon lookup, 2) eligible_count, 3) per-user usage (optional)
function setupCouponMocks(coupon: ReturnType<typeof makeCoupon> | null, eligibleCount = '0', perUserUsageCount = '0') {
  vi.mocked(queryOne)
    .mockResolvedValueOnce(coupon as any)
    .mockResolvedValueOnce({ cnt: eligibleCount } as any)
    .mockResolvedValueOnce({ cnt: perUserUsageCount } as any)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/coupons/apply — authentication', () => {
  it('returns 401 when user is not authenticated', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue(null)
    const req = makeRequest({ code: 'SAVE10', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })
})

describe('POST /api/coupons/apply — valid coupon', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    // Reset the once-queue so each test starts with a clean slate
    vi.mocked(queryOne).mockReset()
  })

  it('applies a valid percentage coupon and returns discount amount', async () => {
    setupCouponMocks(makeCoupon())
    const req = makeRequest({ code: 'SAVE10', subtotal: 1000 })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.couponId).toBe(COUPON_ID)
    expect(body.code).toBe('SAVE10')
    expect(body.discountType).toBe('percentage')
    expect(body.discountAmount).toBe(100) // 10% of 1000
  })

  it('applies a flat discount coupon', async () => {
    setupCouponMocks(makeCoupon({ discount_type: 'flat', discount_value: 50, code: 'FLAT50' }))
    const req = makeRequest({ code: 'FLAT50', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discountType).toBe('flat')
    expect(body.discountAmount).toBe(50)
  })

  it('caps percentage discount at max_discount_amount', async () => {
    setupCouponMocks(
      makeCoupon({
        discount_type: 'percentage',
        discount_value: 20,
        max_discount_amount: 80,
      })
    )
    const req = makeRequest({ code: 'SAVE20', subtotal: 1000 })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    // 20% of 1000 = 200, but capped at 80
    expect(body.discountAmount).toBe(80)
  })

  it('caps discount so it does not exceed the subtotal', async () => {
    setupCouponMocks(makeCoupon({ discount_type: 'flat', discount_value: 9999 }))
    const req = makeRequest({ code: 'BIG', subtotal: 100 })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discountAmount).toBe(100) // capped at subtotal
  })
})

describe('POST /api/coupons/apply — invalid coupon', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne).mockReset()
  })

  it('returns 404 for unknown coupon code', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    const req = makeRequest({ code: 'BADCODE', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Invalid coupon code')
  })

  it('returns 400 for expired coupon', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    setupCouponMocks(makeCoupon({ valid_until: yesterday }))
    const req = makeRequest({ code: 'EXPIRED', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/expired/i)
  })

  it('returns 400 for coupon not yet valid', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    setupCouponMocks(makeCoupon({ valid_from: tomorrow }))
    const req = makeRequest({ code: 'FUTURE', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not valid yet/i)
  })

  it('returns 400 when usage limit is reached', async () => {
    setupCouponMocks(makeCoupon({ usage_limit: 100, times_used: 100 }))
    const req = makeRequest({ code: 'MAXED', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/usage limit/i)
  })

  it('returns 400 when per-user usage limit is reached', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(makeCoupon({ usage_limit_per_user: 1 }) as any)
      .mockResolvedValueOnce({ cnt: '0' } as any)
      .mockResolvedValueOnce({ cnt: '1' } as any)
    const req = makeRequest({ code: 'PERUSER', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already used/i)
  })

  it('returns 400 when subtotal is below minimum purchase amount', async () => {
    setupCouponMocks(makeCoupon({ min_purchase_amount: 1000 }))
    const req = makeRequest({ code: 'MINPURCHASE', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/minimum purchase/i)
  })

  it('returns 400 when coupon is inactive', async () => {
    setupCouponMocks(makeCoupon({ is_active: false }))
    const req = makeRequest({ code: 'INACTIVE', subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no longer active/i)
  })
})

describe('POST /api/coupons/apply — validation', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne).mockReset()
  })

  it('returns 400 when code is missing', async () => {
    const req = makeRequest({ subtotal: 500 })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 when subtotal is missing', async () => {
    const req = makeRequest({ code: 'SAVE10' })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })
})
