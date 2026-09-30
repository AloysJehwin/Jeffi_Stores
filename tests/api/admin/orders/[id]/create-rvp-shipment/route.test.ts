import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/shipping/delhivery', () => ({
  createRVPShipment: vi.fn(),
  listDelhiveryPickupLocations: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenantId: vi.fn().mockResolvedValue(null),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/[id]/create-rvp-shipment/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { createRVPShipment } from '@/lib/shipping/delhivery'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['orders'] }
const PARAMS = { params: Promise.resolve({ id: 'order-1' }) }

function makePost() {
  return new NextRequest('http://localhost/api/admin/orders/order-1/create-rvp-shipment', {
    method: 'POST',
  })
}

const BASE_ORDER = {
  id: 'order-1',
  order_number: 'ORD-001',
  status: 'return_approved',
  total_amount: '500.00',
  created_at: '2024-01-15T10:00:00Z',
  full_name: 'Test Customer',
  address_line1: '123 Main St',
  address_line2: null,
  landmark: null,
  city: 'Chennai',
  state: 'Tamil Nadu',
  postal_code: '600001',
  consignee_phone: '9876543210',
  user_email: 'test@example.com',
}

const RETURN_REQUEST = {
  id: 'ret-1',
  type: 'return',
  rvp_awb_number: null,
}

const ORDER_ITEMS = {
  total_weight: 1500,
  total_qty: 3,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/orders/[id]/create-rvp-shipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DELHIVERY_API_KEY
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing orders scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 503 when DELHIVERY_API_KEY not configured', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'Delhivery API key not configured' })
  })

  it('returns 404 when order not found', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Order not found' })
  })

  it('returns 400 when order status is not return_approved', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...BASE_ORDER, status: 'delivered' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('order status is') })
  })

  it('returns 422 when postal code is invalid', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...BASE_ORDER, postal_code: 'INVALID' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(422)
  })

  it('returns 422 when postal code is missing', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...BASE_ORDER, postal_code: null } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(422)
  })

  it('returns 404 when no active return request found', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_ORDER as any)
      .mockResolvedValueOnce(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'No active return request found for this order' })
  })

  it('returns 409 when RVP shipment already created', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_ORDER as any)
      .mockResolvedValueOnce({ ...RETURN_REQUEST, rvp_awb_number: 'AWB-EXISTING' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'RVP shipment already created', awb: 'AWB-EXISTING' })
  })

  it('creates RVP shipment and updates return request on success', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_ORDER as any)
      .mockResolvedValueOnce(RETURN_REQUEST as any)
      .mockResolvedValueOnce(ORDER_ITEMS as any)
    vi.mocked(createRVPShipment).mockResolvedValue('AWB-NEW123')
    vi.mocked(query).mockResolvedValue(undefined as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.awb).toBe('AWB-NEW123')
    expect(body.message).toContain('AWB-NEW123')
    expect(vi.mocked(query)).toHaveBeenCalledWith(expect.stringContaining('UPDATE return_requests'), [
      'AWB-NEW123',
      'ret-1',
    ])
  })

  it('strips country code from 12-digit phone', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...BASE_ORDER, consignee_phone: '919876543210' } as any)
      .mockResolvedValueOnce(RETURN_REQUEST as any)
      .mockResolvedValueOnce(ORDER_ITEMS as any)
    vi.mocked(createRVPShipment).mockResolvedValue('AWB-123')
    vi.mocked(query).mockResolvedValue(undefined as any)
    await POST(makePost(), PARAMS)
    const shipmentCall = vi.mocked(createRVPShipment).mock.calls[0][0]
    expect(shipmentCall.phone).toBe('9876543210')
  })

  it('uses fallback weight and qty when order items returns null', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_ORDER as any)
      .mockResolvedValueOnce(RETURN_REQUEST as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(createRVPShipment).mockResolvedValue('AWB-FALLBACK')
    vi.mocked(query).mockResolvedValue(undefined as any)
    await POST(makePost(), PARAMS)
    const shipmentCall = vi.mocked(createRVPShipment).mock.calls[0][0]
    expect(shipmentCall.weightKg).toBeGreaterThanOrEqual(0.1)
    expect(shipmentCall.quantity).toBeGreaterThanOrEqual(1)
  })

  it('returns 500 on unexpected error', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockRejectedValue(new Error('db crash'))
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'db crash' })
  })
})
