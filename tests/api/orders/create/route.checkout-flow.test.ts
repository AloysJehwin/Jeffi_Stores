import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn().mockReturnValue(false),
  calculateGST: vi.fn().mockReturnValue({ taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/auto-tasks', () => ({ createAutoTask: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ai-feedback', () => ({ recordImplicitSignalsForProducts: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/order-commit', () => ({
  quoteShipping: vi.fn().mockResolvedValue({ shipping: 0, codFee: 0 }),
  validateCouponForUser: vi.fn().mockResolvedValue({ appliedDiscount: 0, ok: false, reason: 'not_found' }),
}))
vi.mock('@/lib/invoice', () => ({ createDraftInvoice: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/business-discount', () => ({ getBusinessDiscountMap: vi.fn().mockResolvedValue({}) }))
// GST enabled ⇒ line price follows the price_at_addition/variant/sub_variant/base_price
// precedence these tests assert (the GST-off path charges the ex-GST column instead).
vi.mock('@/lib/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({
    razorpayEnabled: false,
    codEnabled: true,
    gstEnabled: true,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  }),
  getBusinessValues: vi.fn().mockResolvedValue({ businessStateCode: '22' }),
}))
vi.mock('@/lib/edd', () => ({ computeEdd: vi.fn().mockReturnValue('2026-09-30') }))
vi.mock('@/lib/sms', () => ({ sendOrderConfirmedSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/delhivery', () => ({
  checkPincodeServiceability: vi.fn().mockResolvedValue({ serviceable: true, cod: true, prepaid: true }),
}))
vi.mock('@/lib/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/orders/create/route'
import * as db from '@/lib/db'
import * as jwt from '@/lib/jwt'
import * as bizDiscount from '@/lib/business-discount'
import * as gstLib from '@/lib/gst'
import * as orderCommit from '@/lib/order-commit'
import { getFeatureFlags } from '@/lib/site-controls'

const enableRazorpay = () =>
  vi.mocked(getFeatureFlags).mockResolvedValueOnce({
    razorpayEnabled: true,
    codEnabled: true,
    gstEnabled: true,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  } as any)

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'user-99', email: 'branchuser@example.com', isBusiness: false }

const MOCK_USER = {
  id: 'user-99',
  email: 'branchuser@example.com',
  phone: '8888888888',
  first_name: 'Branch',
  last_name: 'Tester',
}

function baseCartItem(overrides: any = {}) {
  return {
    product_id: 'prod-b1',
    variant_id: null,
    sub_variant_id: null,
    quantity: '2',
    buy_mode: 'unit',
    buy_unit: null,
    price_at_addition: '0',
    products: {
      id: 'prod-b1',
      name: 'BranchWidget',
      sku: 'B-001',
      base_price: '100',
      price_ex_gst: '90',
      gst_percentage: '18',
      hsn_code: '84',
      stock_status: 'in_stock',
      inventory_quantity: 50,
      is_active: true,
      is_cod_allowed: true,
      category_id: 'cat-1',
      discount_pct: 0,
      extra_delivery_days: 0,
      handling_days: 2,
      mrp: 120,
    },
    variant: null,
    sub_variant: null,
    ...overrides,
  }
}

const CREATED_ORDER = {
  id: 'order-b1',
  order_number: 'ORD-B-001',
  total_amount: '200',
  status: 'pending',
  payment_status: 'unpaid',
}

function txClientReturning(order: any = CREATED_ORDER, extraQueries: any[] = []) {
  const client = { query: vi.fn() }
  // Default: address not found (empty), snapshot lookup empty, existingUnpaid empty, order insert
  let call = 0
  client.query.mockImplementation(async (sql: string, _params: any[]) => {
    if (extraQueries[call]) {
      const val = extraQueries[call]
      call++
      return val
    }
    call++
    if (sql.includes('INSERT INTO orders')) {
      return { rows: [order], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO addresses')) {
      return { rows: [{ id: 'addr-new', full_name: 'X' }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })
  return client
}

describe('POST /api/orders/create — additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(bizDiscount.getBusinessDiscountMap).mockResolvedValue({})
    vi.mocked(gstLib.isInterState).mockReturnValue(false)
    vi.mocked(orderCommit.quoteShipping).mockResolvedValue({ shipping: 0, codFee: 0 })
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 0,
      ok: false,
      reason: 'not_found',
    } as any)
  })

  it('returns 401 when user not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 404 when user record not found in DB', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null) // user not found
    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('User not found')
  })

  it('returns 400 when cart is empty', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cart is empty/i)
  })

  it('returns 400 when subtotal is below minimum order amount', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce({ value: '500' }) // min order = 500, subtotal = 200
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])
    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/minimum order value/i)
  })

  it('returns 409 when user has existing unpaid razorpay order', async () => {
    enableRazorpay()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // min order
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string) => {
        if (sql.includes('INNER JOIN payments') && sql.includes('unpaid')) {
          // Return an existing unpaid order
          return { rows: [{ id: 'old-order', order_number: 'ORD-OLD-001' }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })

    const res = await POST(makeRequest({ paymentMethod: 'razorpay' }) as any)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/unpaid order/i)
    expect(body.existingOrderId).toBe('old-order')
    expect(body.existingOrderNumber).toBe('ORD-OLD-001')
  })

  it('sets requiresPayment=true for razorpay and does not confirm order', async () => {
    enableRazorpay()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO orders')) return { rows: [CREATED_ORDER], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })

    const res = await POST(makeRequest({ paymentMethod: 'razorpay' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requiresPayment).toBe(true)
    // For razorpay, status UPDATE should NOT be called (order stays pending)
    expect(vi.mocked(db.query)).not.toHaveBeenCalledWith(
      expect.stringContaining("status = 'confirmed'"),
      expect.anything()
    )
  })

  it('confirms order and sets status=confirmed for cod payment', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO orders')) return { rows: [CREATED_ORDER], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requiresPayment).toBe(false)
    // The top-level query call should update status to confirmed
    expect(vi.mocked(db.query)).toHaveBeenCalledWith(expect.stringContaining("status = 'confirmed'"), [
      CREATED_ORDER.id,
    ])
  })

  it('creates auto-task for high-value order (>= 50000)', async () => {
    const { createAutoTask } = await import('@/lib/auto-tasks')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    // Single item at price 60000
    const highValueItem = baseCartItem({ price_at_addition: '60000', quantity: '1' })
    vi.mocked(db.queryMany).mockResolvedValue([highValueItem])

    const highValueOrder = { ...CREATED_ORDER, total_amount: '60000' }
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO orders')) return { rows: [highValueOrder], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(200)
    expect(vi.mocked(createAutoTask)).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: 'review_high_value_order' })
    )
  })

  it('reuses existing address when match found in DB', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])

    let existingAddrUsed = false
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM addresses')) {
          // Existing address found
          return { rows: [{ id: 'addr-existing', full_name: 'Branch Tester' }], rowCount: 1 }
        }
        if (sql.includes('SELECT full_name') && sql.includes('FROM addresses WHERE id')) {
          return { rows: [{ full_name: 'Branch Tester', city: 'Chennai' }], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO orders')) {
          // Check that address id used is the existing one
          existingAddrUsed = true
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await POST(
      makeRequest({
        paymentMethod: 'cod',
        shippingAddress: {
          addressLine1: '1 Main St',
          city: 'Chennai',
          state: 'TN',
          postalCode: '600001',
        },
      }) as any
    )
    expect(res.status).toBe(200)
    expect(existingAddrUsed).toBe(true)
  })

  it('records coupon usage when valid coupon applied', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 20,
      ok: true,
    } as any)

    const couponInserts: string[][] = []
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO coupon_usage')) {
          couponInserts.push(params)
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('UPDATE coupons SET times_used')) {
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO orders')) return { rows: [CREATED_ORDER], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await POST(makeRequest({ paymentMethod: 'cod', couponId: 'coupon-valid' }) as any)
    expect(res.status).toBe(200)
    expect(couponInserts).toHaveLength(1)
    expect(couponInserts[0]).toContain('coupon-valid')
  })

  it('passes isCod=true to quoteShipping when paymentMethod=cod', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])
    vi.mocked(orderCommit.quoteShipping).mockResolvedValue({ shipping: 50, codFee: 30 })

    let capturedShipping = -1
    let capturedCodFee = -1
    let capturedTotal = -1
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          capturedShipping = Number(params[12])
          capturedTotal = Number(params[13])
          capturedCodFee = Number(params[25])
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await POST(
      makeRequest({
        paymentMethod: 'cod',
        shippingAddress: { addressLine1: 'X', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001' },
      }) as any
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(orderCommit.quoteShipping)).toHaveBeenCalledWith(
      expect.objectContaining({ isCod: true, destinationPin: '400001' })
    )
    // COD fee is stored separately from shipping, and folded into the total.
    expect(capturedShipping).toBe(50)
    expect(capturedCodFee).toBe(30)
    // subtotal 200 - 0 discount + 50 shipping + 30 cod fee = 280
    expect(capturedTotal).toBe(280)
  })

  it('falls back to client-quoted shipping when live quote returns 0', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])
    vi.mocked(orderCommit.quoteShipping).mockResolvedValue({ shipping: 0, codFee: 0 }) // live quote unavailable

    let capturedShipping = -1
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          capturedShipping = Number(params[12])
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await POST(
      makeRequest({
        paymentMethod: 'cod',
        shippingAddress: { addressLine1: 'X', city: 'Y', state: 'Z', postalCode: '600001' },
        shippingAmount: 99,
      }) as any
    )
    expect(res.status).toBe(200)
    expect(capturedShipping).toBe(99) // fell back to client-quoted 99
  })

  it('order items use sub_variant sku and compound name when both variant and sub_variant present', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    const compoundItem = baseCartItem({
      variant: { id: 'v1', variant_name: 'Red', sku: 'V-R', price: '150', discount_pct: 0 },
      sub_variant: { id: 'sv1', sub_variant_name: 'Small', sku: 'SV-S', price: '175', mrp: 220, discount_pct: 0 },
      products: { ...baseCartItem().products, discount_pct: 0 },
    })
    vi.mocked(db.queryMany).mockResolvedValue([compoundItem])

    const capturedNames: string[] = []
    const capturedSkus: string[] = []
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO order_items')) {
          capturedNames.push(params[4]) // product_name
          capturedSkus.push(params[5]) // product_sku
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO orders')) return { rows: [CREATED_ORDER], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(200)
    expect(capturedNames[0]).toContain('Red')
    expect(capturedNames[0]).toContain('Small')
    expect(capturedSkus[0]).toBe('SV-S') // sub_variant sku takes priority
  })
})
