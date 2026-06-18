import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/einvoice', () => ({
  generateIRN: vi.fn(),
  cancelIRN: vi.fn(),
  isEInvoiceConfigured: vi.fn().mockReturnValue(true),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST, DELETE } from '@/app/api/admin/orders/[id]/einvoice/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { generateIRN, cancelIRN, isEInvoiceConfigured } from '@/lib/einvoice'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGenerateIRN = vi.mocked(generateIRN)
const mockCancelIRN = vi.mocked(cancelIRN)
const mockIsEInvoiceConfigured = vi.mocked(isEInvoiceConfigured)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['orders'] }

function makePost(id: string) {
  return new NextRequest(`http://localhost/api/admin/orders/${id}/einvoice`, { method: 'POST' })
}

function makeDelete(id: string, body: unknown = {}) {
  return new NextRequest(`http://localhost/api/admin/orders/${id}/einvoice`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleOrder = {
  id: 'ord-1',
  invoice_number: 'JS/2024-25/0001',
  invoice_date: '2024-01-15T10:00:00Z',
  created_at: '2024-01-15T09:00:00Z',
  customer_name: 'Alice',
  full_name: 'Alice Smith',
  address_line1: '123 Main St',
  city: 'Chennai',
  state: 'Tamil Nadu',
  state_code: '33',
  postal_code: '600001',
  buyer_gstin: null,
  irn: null,
  irn_status: null,
  taxable_amount: '1000.00',
  cgst_amount: '90.00',
  sgst_amount: '90.00',
  igst_amount: '0.00',
  total_amount: '1180.00',
}

const sampleItems = [
  {
    product_name: 'Widget',
    quantity: 2,
    unit_price: '500.00',
    total_price: '1000.00',
    taxable_amount: '1000.00',
    cgst_amount: '90.00',
    sgst_amount: '90.00',
    igst_amount: '0.00',
    gst_rate: '18',
    hsn_code: '8471',
    created_at: '2024-01-15',
  },
]

const sampleSettings = [
  { key: 'business_gstin', value: '33ABCDE1234F1Z5' },
  { key: 'business_legal_name', value: 'Jeffi Stores Pvt Ltd' },
  { key: 'business_address', value: '456 Business Ave' },
  { key: 'business_city', value: 'Chennai' },
  { key: 'business_state_code', value: '33' },
  { key: 'business_pincode', value: '600002' },
]

const irnResult = {
  irn: 'IRN-ABCDEF123456',
  ackNo: 'ACK-001',
  ackDt: '2024-01-15',
  signedQRCode: 'QR-DATA',
  status: 'generated',
}

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/admin/orders/[id]/einvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockIsEInvoiceConfigured.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
  })

  it('returns 404 when order not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Order not found')
  })

  it('returns 422 when invoice not yet generated', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...sampleOrder, invoice_number: null } as any)
    const res = await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invoice not generated yet')
  })

  it('returns 409 when IRN already generated', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...sampleOrder, irn: 'EXISTING-IRN', irn_status: 'generated' } as any)
    const res = await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('IRN already generated')
    expect(body.irn).toBe('EXISTING-IRN')
  })

  it('generates IRN successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(sampleOrder as any)    // order fetch
      .mockResolvedValueOnce(undefined as any)      // UPDATE returning
    mockQueryMany
      .mockResolvedValueOnce(sampleItems as any)    // order items
      .mockResolvedValueOnce(sampleSettings as any) // site settings
    mockGenerateIRN.mockResolvedValueOnce(irnResult as any)

    const res = await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.irn).toBe('IRN-ABCDEF123456')
    expect(body.ackNo).toBe('ACK-001')
    expect(body.configured).toBe(true)
  })

  it('builds B2B supply type when buyer_gstin present', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ ...sampleOrder, buyer_gstin: '29ABCDE1234F1Z5' } as any)
      .mockResolvedValueOnce(undefined as any)
    mockQueryMany
      .mockResolvedValueOnce(sampleItems as any)
      .mockResolvedValueOnce(sampleSettings as any)
    mockGenerateIRN.mockResolvedValueOnce(irnResult as any)

    const res = await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(200)
    // Verify generateIRN was called with B2B
    const callArgs = mockGenerateIRN.mock.calls[0][0]
    expect(callArgs.supplyType).toBe('B2B')
  })

  it('uses B2C supply type when buyer_gstin absent', async () => {
    mockQueryOne
      .mockResolvedValueOnce(sampleOrder as any)
      .mockResolvedValueOnce(undefined as any)
    mockQueryMany
      .mockResolvedValueOnce(sampleItems as any)
      .mockResolvedValueOnce(sampleSettings as any)
    mockGenerateIRN.mockResolvedValueOnce(irnResult as any)

    await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    const callArgs = mockGenerateIRN.mock.calls[0][0]
    expect(callArgs.supplyType).toBe('B2C')
  })

  it('returns 500 when generateIRN throws', async () => {
    mockQueryOne.mockResolvedValueOnce(sampleOrder as any)
    mockQueryMany
      .mockResolvedValueOnce(sampleItems as any)
      .mockResolvedValueOnce(sampleSettings as any)
    mockGenerateIRN.mockRejectedValueOnce(new Error('IRP service unavailable'))

    const res = await POST(makePost('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('IRP service unavailable')
  })
})

// ── DELETE tests ──────────────────────────────────────────────────────────────

describe('DELETE /api/admin/orders/[id]/einvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await DELETE(makeDelete('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDelete('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when order not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await DELETE(makeDelete('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Order not found')
  })

  it('returns 422 when order has no IRN', async () => {
    mockQueryOne.mockResolvedValueOnce({ irn: null, irn_status: null } as any)
    const res = await DELETE(makeDelete('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('No IRN on this order')
  })

  it('returns 409 when IRN already cancelled', async () => {
    mockQueryOne.mockResolvedValueOnce({ irn: 'SOME-IRN', irn_status: 'cancelled' } as any)
    const res = await DELETE(makeDelete('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('IRN already cancelled')
  })

  it('cancels IRN successfully for real IRN', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ irn: 'REAL-IRN-001', irn_status: 'generated' } as any)  // order fetch
      .mockResolvedValueOnce(undefined as any)                                           // UPDATE
    mockCancelIRN.mockResolvedValueOnce(undefined as any)

    const res = await DELETE(makeDelete('ord-1', { reason: 1, remark: 'Test cancel' }), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockCancelIRN).toHaveBeenCalledWith('REAL-IRN-001', 1, 'Test cancel')
  })

  it('skips cancelIRN for STUB IRN (test environment)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ irn: 'STUB-123456', irn_status: 'generated' } as any)
      .mockResolvedValueOnce(undefined as any)

    const res = await DELETE(makeDelete('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(200)
    expect(mockCancelIRN).not.toHaveBeenCalled()
  })

  it('uses default reason (3) and remark when not provided', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ irn: 'REAL-IRN-999', irn_status: 'generated' } as any)
      .mockResolvedValueOnce(undefined as any)
    mockCancelIRN.mockResolvedValueOnce(undefined as any)

    await DELETE(makeDelete('ord-1', {}), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(mockCancelIRN).toHaveBeenCalledWith('REAL-IRN-999', 3, 'Order cancelled')
  })

  it('returns 500 on unexpected error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('DB failure'))
    const res = await DELETE(makeDelete('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB failure')
  })
})
