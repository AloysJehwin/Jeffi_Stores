// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/catalog/gst', () => ({
  isInterState: vi.fn().mockReturnValue(false),
  calculateGST: vi.fn().mockReturnValue({ taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shared/ai-feedback', () => ({ recordImplicitSignalsForProducts: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/orders/order-commit', () => ({
  quoteShipping: vi.fn().mockResolvedValue({ shipping: 0, codFee: 0 }),
  validateCouponForUser: vi.fn().mockResolvedValue({ appliedDiscount: 0, ok: false, reason: 'not_found' }),
}))
vi.mock('@/lib/documents/invoice', () => ({ createDraftInvoice: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/catalog/business-discount', () => ({ getBusinessDiscountMap: vi.fn().mockResolvedValue({}) }))
// GST enabled ⇒ line price follows the price_at_addition/variant/sub_variant/base_price
// precedence these tests assert (the GST-off path charges the ex-GST column instead).
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({
    razorpayEnabled: false,
    codEnabled: true,
    gstEnabled: true,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  }),
  getBusinessValues: vi.fn().mockResolvedValue({ businessStateCode: '22' }),
}))
vi.mock('@/lib/shipping/edd', () => ({ computeEdd: vi.fn().mockReturnValue('2026-09-30') }))
vi.mock('@/lib/shared/sms', () => ({ sendOrderConfirmedSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shipping/delhivery', () => ({
  checkPincodeServiceability: vi.fn().mockResolvedValue({ serviceable: true, cod: true, prepaid: true }),
}))
vi.mock('@/lib/shared/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/shared/validate')>()
  return { ...actual }
})

import { POST } from '@storefront/app/api/(public)/orders/create/route'
import * as db from '@/lib/shared/db'
import * as jwt from '@/lib/auth/jwt'
import * as bizDiscount from '@/lib/catalog/business-discount'
import * as gstLib from '@/lib/catalog/gst'
import * as orderCommit from '@/lib/orders/order-commit'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

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

function requestWithCookie(body: unknown, cookie: string) {
  return new Request('http://localhost/api/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

function codOrderSetup() {
  vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
  vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
  vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])
  const client = txClientReturning()
  vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => fn(client))
  vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
  return client
}

describe('POST /api/orders/create — click / UTM attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(bizDiscount.getBusinessDiscountMap).mockResolvedValue({})
    vi.mocked(gstLib.isInterState).mockReturnValue(false)
    vi.mocked(orderCommit.quoteShipping).mockResolvedValue({ shipping: 0, codFee: 0 })
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ appliedDiscount: 0, ok: false } as any)
  })

  it('stamps the attribution cookie onto the new order inside the transaction', async () => {
    const client = codOrderSetup()
    const ts = Date.now() - 2 * 86400000
    const attr = encodeURIComponent(
      JSON.stringify({
        gclid: 'Cj0KCQ-abc',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'diwali',
        landing_path: '/products/bolt',
        ts,
      })
    )
    const res = await POST(requestWithCookie({ paymentMethod: 'cod' }, `user_sid=x; jeffi_attr=${attr}`) as any)
    expect(res.status).toBe(200)

    const update = client.query.mock.calls.find(([sql]: any[]) => String(sql).includes('SET gclid'))
    expect(update).toBeTruthy()
    const params = update![1]
    expect(params[0]).toBe(CREATED_ORDER.id)
    expect(params.slice(1, 10)).toEqual([
      'Cj0KCQ-abc',
      null,
      null,
      'google',
      'cpc',
      'diwali',
      null,
      null,
      '/products/bolt',
    ])
    expect(params[10]).toBe(new Date(ts).toISOString())
  })

  it('stamps the ads consent choice with the attribution, or on its own', async () => {
    let client = codOrderSetup()
    const attr = encodeURIComponent(JSON.stringify({ gclid: 'Cj0KCQ-abc', landing_path: '/', ts: Date.now() - 86400000 }))
    await POST(requestWithCookie({ paymentMethod: 'cod' }, `jeffi_attr=${attr}; jeffi_consent=v1.1.1`) as any)
    const update = client.query.mock.calls.find(([sql]: any[]) => String(sql).includes('SET gclid'))!
    expect(update[1][11]).toBe(true)

    client = codOrderSetup()
    await POST(requestWithCookie({ paymentMethod: 'cod' }, 'jeffi_consent=v1.1.0') as any)
    const consent = client.query.mock.calls.find(([sql]: any[]) => String(sql).includes('SET ads_consent'))!
    expect(consent[1]).toEqual([CREATED_ORDER.id, false])
  })

  it('leaves the order untouched without an attribution cookie', async () => {
    const client = codOrderSetup()
    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(200)
    expect(client.query.mock.calls.some(([sql]: any[]) => String(sql).includes('SET gclid'))).toBe(false)
  })

  it('ignores an expired attribution cookie', async () => {
    const client = codOrderSetup()
    const attr = encodeURIComponent(JSON.stringify({ gclid: 'old', landing_path: '/', ts: Date.now() - 91 * 86400000 }))
    await POST(requestWithCookie({ paymentMethod: 'cod' }, `jeffi_attr=${attr}`) as any)
    expect(client.query.mock.calls.some(([sql]: any[]) => String(sql).includes('SET gclid'))).toBe(false)
  })
})
