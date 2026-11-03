import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — ALL variables used inside vi.mock() factories must be defined
// inside the factory itself (factories are hoisted above const declarations).
// Expose the spies via vi.mocked() after import instead.
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
}))

vi.mock('@/lib/shared/ai-feedback', () => ({
  recordImplicitSignal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/guest-user', () => ({
  getUserIdForSession: vi.fn().mockResolvedValue('guest-user-uuid'),
}))

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks are registered
// ---------------------------------------------------------------------------
import { GET, POST, PATCH, DELETE } from '@storefront/app/api/(public)/cart/route'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { cookies } from 'next/headers'
import { query, queryOne, queryMany } from '@/lib/shared/db'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const USER_ID = '550e8400-e29b-41d4-a716-446655440001'
const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440002'
const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440003'
const CART_ITEM_ID = '550e8400-e29b-41d4-a716-446655440004'

function makeRequest(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cart', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryMany).mockResolvedValue([{ id: CART_ITEM_ID, product_id: PRODUCT_ID, quantity: 2 }])
  })

  it('returns cart items for the resolved user', async () => {
    const req = makeRequest('GET', 'http://localhost/api/cart')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('items')
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(CART_ITEM_ID)
  })

  it('returns empty array when cart is empty', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    const req = makeRequest('GET', 'http://localhost/api/cart')
    const res = await GET(req as any)
    const body = await res.json()
    expect(body.items).toEqual([])
  })
})

describe('POST /api/cart — insert (new item)', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    // product lookup returns the product row
    vi.mocked(queryOne).mockResolvedValue({
      id: PRODUCT_ID,
      name: 'Test Product',
      base_price: 100,
      price_ex_gst: 90,
      is_active: true,
    } as any)
    // upsert INSERT: inserted=true, quantity=1
    vi.mocked(query).mockResolvedValue({
      rows: [{ quantity: 1, inserted: true }],
      rowCount: 1,
    } as any)
  })

  it('inserts a new item and returns "Item added to cart" with quantity=1', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item added to cart')
    expect(body.quantity).toBe(1)
  })
})

describe('POST /api/cart — upsert (same item again)', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne).mockResolvedValue({
      id: PRODUCT_ID,
      name: 'Test Product',
      base_price: 100,
      price_ex_gst: 90,
      is_active: true,
    } as any)
    // ON CONFLICT path: inserted=false, quantity incremented to 3
    vi.mocked(query).mockResolvedValue({
      rows: [{ quantity: 3, inserted: false }],
      rowCount: 1,
    } as any)
  })

  it('increments quantity on conflict and returns "Cart updated"', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Cart updated')
    expect(body.quantity).toBe(3)
  })
})

describe('POST /api/cart — item currently saved for later', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne).mockResolvedValue({
      id: PRODUCT_ID,
      name: 'Test Product',
      base_price: 100,
      price_ex_gst: 90,
      is_active: true,
    } as any)
    vi.mocked(query).mockResolvedValue({ rows: [{ quantity: 1, inserted: false }], rowCount: 1 } as any)
  })

  it('moves the saved row back into the cart as a fresh add instead of growing the saved row', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/cart', { productId: PRODUCT_ID, quantity: 1 }) as any
    )
    expect(res.status).toBe(200)
    const sql = vi.mocked(query).mock.calls[0]![0] as string
    expect(sql).toContain('saved_for_later = FALSE')
    expect(sql).toContain('saved_at = NULL')
    expect(sql).toContain(
      'CASE WHEN cart_items.saved_for_later THEN EXCLUDED.quantity ELSE cart_items.quantity + EXCLUDED.quantity END'
    )
    expect(sql).toContain(
      'CASE WHEN cart_items.saved_for_later THEN EXCLUDED.price_at_addition ELSE cart_items.price_at_addition END'
    )
  })
})

describe('POST /api/cart — null variantId upsert', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne).mockResolvedValue({
      id: PRODUCT_ID,
      name: 'Test Product',
      base_price: 100,
      price_ex_gst: 90,
      is_active: true,
    } as any)
    vi.mocked(query).mockResolvedValue({
      rows: [{ quantity: 2, inserted: false }],
      rowCount: 1,
    } as any)
  })

  it('handles null variantId correctly (NULLS NOT DISTINCT upsert key)', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      variantId: null,
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    // Should treat null variant same as no-variant row
    expect(['Item added to cart', 'Cart updated']).toContain(body.message)
    expect(typeof body.quantity).toBe('number')
  })
})

describe('POST /api/cart — validation errors', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
  })

  it('returns 400 when both productId and variantId are missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })
})

describe('POST /api/cart — product not found', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    // queryOne returns null — product does not exist
    vi.mocked(queryOne).mockResolvedValue(null)
  })

  it('returns 404 when product does not exist', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Product not found')
  })
})

describe('PATCH /api/cart — quantity update', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(cookies).mockResolvedValue({
      get: (_k: string) => ({ value: 'sess-abc' }) as any,
      set: vi.fn(),
      delete: vi.fn(),
    } as any)
    // Cart item exists check
    vi.mocked(queryOne).mockResolvedValue({ id: CART_ITEM_ID, user_id: USER_ID } as any)
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('updates quantity and returns 200 "Cart updated"', async () => {
    const req = makeRequest('PATCH', 'http://localhost/api/cart', {
      cartItemId: CART_ITEM_ID,
      quantity: 5,
    })
    const res = await PATCH(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Cart updated')
  })
})

describe('PATCH /api/cart — savedForLater', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(cookies).mockResolvedValue({
      get: (_k: string) => ({ value: 'sess-abc' }) as any,
      set: vi.fn(),
      delete: vi.fn(),
    } as any)
    vi.mocked(queryOne).mockResolvedValue({ id: CART_ITEM_ID, user_id: USER_ID } as any)
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('saves item for later and returns "Saved for later"', async () => {
    const req = makeRequest('PATCH', 'http://localhost/api/cart', {
      cartItemId: CART_ITEM_ID,
      savedForLater: true,
    })
    const res = await PATCH(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Saved for later')
  })

  it('moves item back to cart and returns "Moved to cart"', async () => {
    const req = makeRequest('PATCH', 'http://localhost/api/cart', {
      cartItemId: CART_ITEM_ID,
      savedForLater: false,
    })
    const res = await PATCH(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Moved to cart')
  })
})

describe('DELETE /api/cart', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(cookies).mockResolvedValue({
      get: (_k: string) => ({ value: 'sess-abc' }) as any,
      set: vi.fn(),
      delete: vi.fn(),
    } as any)
    // queryOne for pre-delete product lookup
    vi.mocked(queryOne).mockResolvedValue({
      product_id: PRODUCT_ID,
      product_name: 'Test Product',
    } as any)
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('removes the item and returns 200 "Item removed from cart"', async () => {
    const req = makeRequest('DELETE', `http://localhost/api/cart?id=${CART_ITEM_ID}`)
    const res = await DELETE(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item removed from cart')
  })

  it('still returns 200 when cart item lookup returns null (no logActivity)', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    const req = makeRequest('DELETE', `http://localhost/api/cart?id=${CART_ITEM_ID}`)
    const res = await DELETE(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item removed from cart')
  })
})

describe('GET /api/cart — saved items filter', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryMany).mockResolvedValue([{ id: CART_ITEM_ID, product_id: PRODUCT_ID, saved_for_later: true }])
  })

  it('returns saved items when saved=1 is passed', async () => {
    const req = makeRequest('GET', 'http://localhost/api/cart?saved=1')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
  })
})

describe('POST /api/cart — subVariantId only (no variantId)', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    // product lookup
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, base_price: 100, price_ex_gst: 90, is_active: true } as any) // product
      .mockResolvedValueOnce({ id: '550e8400-e29b-41d4-a716-446655440005', price: 120 } as any) // subVariant
    vi.mocked(query).mockResolvedValue({ rows: [{ quantity: 1, inserted: true }], rowCount: 1 } as any)
  })

  it('uses subVariant price when only subVariantId provided', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      subVariantId: '550e8400-e29b-41d4-a716-446655440005',
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Item added to cart')
  })
})

describe('POST /api/cart — subVariantId + variantId', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, base_price: 100, price_ex_gst: 90, is_active: true } as any) // product
      .mockResolvedValueOnce({ id: '550e8400-e29b-41d4-a716-446655440005', price: 130 } as any) // subVariant
      .mockResolvedValueOnce({ id: VARIANT_ID, price: 110 } as any) // variant
    vi.mocked(query).mockResolvedValue({ rows: [{ quantity: 1, inserted: true }], rowCount: 1 } as any)
  })

  it('uses subVariant price when both subVariantId and variantId provided', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      subVariantId: '550e8400-e29b-41d4-a716-446655440005',
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/cart — subVariant not found', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, base_price: 100, price_ex_gst: 90, is_active: true } as any)
      .mockResolvedValueOnce(null) // subVariant not found
  })

  it('returns 404 when sub-variant does not exist', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      subVariantId: '550e8400-e29b-41d4-a716-446655440005',
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Sub-variant not found')
  })
})

describe('POST /api/cart — variant not found', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, base_price: 100, price_ex_gst: 90, is_active: true } as any)
      .mockResolvedValueOnce(null) // variant not found
  })

  it('returns 404 when variant does not exist', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      quantity: 1,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Variant not found')
  })
})

describe('POST /api/cart — buyMode factor multiplication', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, base_price: 100, price_ex_gst: 90, is_active: true } as any) // product
      .mockResolvedValueOnce({ factor: '12', is_base: false }) // unit row
    vi.mocked(query).mockResolvedValue({ rows: [{ quantity: 1, inserted: true }], rowCount: 1 } as any)
  })

  it('multiplies price by unit factor when buyMode != "unit"', async () => {
    const req = makeRequest('POST', 'http://localhost/api/cart', {
      productId: PRODUCT_ID,
      quantity: 1,
      buyMode: 'dozen',
      buyUnit: 'doz',
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    // price should have been multiplied by factor 12
    const callArgs = vi.mocked(query).mock.calls[0]!
    const priceArg = callArgs[1]![5] // price_at_addition is the 6th param (index 5)
    expect(priceArg).toBe(1080) // 90 * 12
  })
})

describe('PATCH /api/cart — no valid update fields', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(cookies).mockResolvedValue({
      get: (_k: string) => ({ value: 'sess-abc' }) as any,
      set: vi.fn(),
      delete: vi.fn(),
    } as any)
    vi.mocked(queryOne).mockResolvedValue({ id: CART_ITEM_ID, user_id: USER_ID } as any)
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('returns 400 when neither quantity nor savedForLater is provided', async () => {
    const req = makeRequest('PATCH', 'http://localhost/api/cart', {
      cartItemId: CART_ITEM_ID,
    })
    const res = await PATCH(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('No valid update fields')
  })
})

describe('PATCH /api/cart — cart item not found', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(cookies).mockResolvedValue({
      get: (_k: string) => ({ value: 'sess-abc' }) as any,
      set: vi.fn(),
      delete: vi.fn(),
    } as any)
    vi.mocked(queryOne).mockResolvedValue(null)
  })

  it('returns 404 when cart item not found', async () => {
    const req = makeRequest('PATCH', 'http://localhost/api/cart', {
      cartItemId: CART_ITEM_ID,
      quantity: 3,
    })
    const res = await PATCH(req as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Cart item not found')
  })
})

describe('POST /api/cart — digital product', () => {
  const digitalProduct = { id: PRODUCT_ID, name: 'E-book', base_price: 499, is_active: true, is_digital: true }

  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(query)
      .mockReset()
      .mockResolvedValue({ rows: [{ quantity: 1, inserted: true }], rowCount: 1 } as any)
    vi.mocked(queryOne)
      .mockReset()
      .mockResolvedValueOnce(digitalProduct as any)
      .mockResolvedValue(null)
  })

  it('rejects with 409 DIGITAL_BUY_NOW_ONLY and never writes a cart line', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/cart', { productId: PRODUCT_ID, quantity: 1 }) as any
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Digital products are bought directly — use Buy Now',
      code: 'DIGITAL_BUY_NOW_ONLY',
    })
    expect(vi.mocked(query)).not.toHaveBeenCalled()
  })
})

describe('GET /api/cart — legacy digital lines', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(query)
      .mockReset()
      .mockResolvedValue({ rows: [], rowCount: 1 } as any)
    vi.mocked(queryMany).mockReset().mockResolvedValue([])
  })

  it('purges digital lines for the user and excludes them from the listing', async () => {
    const res = await GET(makeRequest('GET', 'http://localhost/api/cart') as any)
    expect(res.status).toBe(200)
    const [delSql, delParams] = vi.mocked(query).mock.calls[0]! as [string, any[]]
    expect(delSql).toMatch(/DELETE FROM cart_items/)
    expect(delSql).toMatch(/is_digital = TRUE/)
    expect(delParams).toEqual(['guest-user-uuid'])
    expect(String(vi.mocked(queryMany).mock.calls[0]![0])).toMatch(/COALESCE\(p\.is_digital, FALSE\) = FALSE/)
  })
})

describe('PATCH /api/cart — digital line', () => {
  it('drops a legacy digital line and returns 409', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryOne)
      .mockReset()
      .mockResolvedValueOnce({ id: CART_ITEM_ID, is_digital: true } as any)
    vi.mocked(query)
      .mockReset()
      .mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost/api/cart', { cartItemId: CART_ITEM_ID, savedForLater: false }) as any
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DIGITAL_BUY_NOW_ONLY')
    expect(String(vi.mocked(query).mock.calls[0]![0])).toMatch(/DELETE FROM cart_items/)
  })
})

describe('POST /api/cart — selling-unit max counts the existing line', () => {
  const unitRow = { unit: 'pc', factor: '1', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: '100' }

  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(query)
      .mockReset()
      .mockResolvedValue({ rows: [{ quantity: 100, inserted: false }], rowCount: 1 } as any)
  })

  function mockLookups(existing: number | null) {
    vi.mocked(queryOne)
      .mockReset()
      .mockResolvedValueOnce({ id: PRODUCT_ID, name: 'Bolt', base_price: 10, is_active: true } as any) // product
      .mockResolvedValueOnce({ factor: '1', is_base: true } as any) // unit factor
      .mockResolvedValueOnce(unitRow as any) // unit constraint
      .mockResolvedValueOnce(existing == null ? null : ({ quantity: String(existing) } as any)) // active line
  }

  const add = (quantity: number) =>
    POST(
      makeRequest('POST', 'http://localhost/api/cart', {
        productId: PRODUCT_ID,
        quantity,
        buyMode: 'pc',
        buyUnit: 'pc',
      }) as any
    )

  it('rejects 100 more when 5 are already in the cart, with the remaining amount', async () => {
    mockLookups(5)
    const res = await add(100)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'You can add up to 95 more — 5 already in your cart (max 100)',
      code: 'UNIT_MAX_EXCEEDED',
    })
    expect(vi.mocked(query)).not.toHaveBeenCalled()
  })

  it('accepts exactly the remaining 95', async () => {
    mockLookups(5)
    const res = await add(95)
    expect(res.status).toBe(200)
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1)
  })

  it('says the line is full once it holds max_qty', async () => {
    mockLookups(100)
    const res = await add(1)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Max quantity already in cart (max 100)')
  })

  it('still allows a full max_qty add to an empty line', async () => {
    mockLookups(null)
    const res = await add(100)
    expect(res.status).toBe(200)
  })

  it('only counts active (not saved-for-later) lines of the same unit', async () => {
    mockLookups(0)
    await add(1)
    const lineSql = String(vi.mocked(queryOne).mock.calls[3]![0])
    expect(lineSql).toMatch(/buy_mode = \$5/)
    expect(lineSql).toMatch(/saved_for_later, FALSE\) = FALSE/)
  })
})

describe('PATCH /api/cart — quantity respects max_qty', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(cookies).mockResolvedValue({
      get: (_k: string) => ({ value: 'sess-abc' }) as any,
      set: vi.fn(),
      delete: vi.fn(),
    } as any)
    vi.mocked(queryOne)
      .mockReset()
      .mockResolvedValueOnce({
        id: CART_ITEM_ID,
        product_id: PRODUCT_ID,
        variant_id: null,
        sub_variant_id: null,
        buy_unit: 'pc',
        is_digital: false,
      } as any)
      .mockResolvedValueOnce({
        unit: 'pc',
        factor: '1',
        dimension: 'count',
        qty_step: '1',
        min_qty: '1',
        max_qty: '100',
      } as any)
    vi.mocked(query)
      .mockReset()
      .mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('rejects a stepper value above max_qty', async () => {
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost/api/cart', { cartItemId: CART_ITEM_ID, quantity: 101 }) as any
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Maximum quantity is 100 pc.')
    expect(vi.mocked(query)).not.toHaveBeenCalled()
  })

  it('accepts max_qty itself', async () => {
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost/api/cart', { cartItemId: CART_ITEM_ID, quantity: 100 }) as any
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(query).mock.calls[0]![1]).toEqual([100, CART_ITEM_ID])
  })
})
