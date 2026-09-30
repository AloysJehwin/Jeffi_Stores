import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/documents/label-pdf', () => ({
  generateBatchLabelPDF: vi.fn().mockResolvedValue(Buffer.from('batch-pdf')),
  generateSerialLabelPDF: vi.fn().mockResolvedValue(Buffer.from('serial-pdf')),
}))

import { POST } from '@/app/api/admin/labels/batch/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { generateBatchLabelPDF, generateSerialLabelPDF } from '@/lib/documents/label-pdf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockBatchPdf = vi.mocked(generateBatchLabelPDF)
const mockSerialPdf = vi.mocked(generateSerialLabelPDF)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['labels:write'] } as any

function makeReq(body: any) {
  return new NextRequest('http://localhost/api/admin/labels/batch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// A request whose json() throws, to hit the `.catch(() => ({}))` fallback branch.
function makeBadJsonReq() {
  return new NextRequest('http://localhost/api/admin/labels/batch', {
    method: 'POST',
    body: 'not-json{',
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(admin)
  mockHasScope.mockReturnValue(true)
  mockBatchPdf.mockResolvedValue(Buffer.from('batch-pdf'))
  mockSerialPdf.mockResolvedValue(Buffer.from('serial-pdf'))
})

describe('POST /api/admin/labels/batch — auth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ batch_ids: ['b1'] }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq({ batch_ids: ['b1'] }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/permission/i)
  })
})

describe('POST /api/admin/labels/batch — validation', () => {
  it('returns 400 when nothing provided', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/batch_ids/)
  })

  it('handles malformed JSON body (empty object fallback) → 400', async () => {
    const res = await POST(makeBadJsonReq())
    expect(res.status).toBe(400)
  })
})

describe('POST /api/admin/labels/batch — serial mode', () => {
  it('generates serial labels from serial_ids', async () => {
    mockQueryMany.mockResolvedValue([
      { serial_number: 'SN1', product_name: 'Bolt', sku: 'B1', variant_name: 'M6', lot_number: 'L1' },
    ])
    const res = await POST(makeReq({ serial_ids: ['s1', ''] }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(/serial-labels-1\.pdf/)
    // serial_ids branch → ANY($1::uuid[]); filter(Boolean) drops empty string
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('ps.id = ANY($1::uuid[])'), [['s1']])
    expect(mockSerialPdf).toHaveBeenCalledWith(
      [
        {
          serialNumber: 'SN1',
          productName: 'Bolt',
          sku: 'B1',
          variantName: 'M6',
          lotNumber: 'L1',
          showPrice: false,
          mrp: undefined,
          priceExGst: undefined,
          gstPercentage: undefined,
          qrUrl: undefined,
        },
      ],
      1,
      false,
      undefined
    )
  })

  it('generates serial labels from serial_numbers when no ids', async () => {
    mockQueryMany.mockResolvedValue([
      { serial_number: 'SN2', product_name: 'Nut', sku: 'N1', variant_name: null, lot_number: null },
    ])
    const res = await POST(makeReq({ serial_numbers: ['SN2'], copies: 2, sheet: true, size: '40x60' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('ps.serial_number = ANY($1::text[])'), [['SN2']])
    expect(mockSerialPdf).toHaveBeenCalledWith(expect.any(Array), 2, true, '40x60')
  })

  it('returns 404 when no serials found', async () => {
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makeReq({ serial_ids: ['s1'] }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/No serials/)
  })
})

describe('POST /api/admin/labels/batch — batch mode (legacy batch_ids)', () => {
  it('generates one label per batch id', async () => {
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid1',
        product_name: 'Bolt',
        sku: 'B1',
        variant_name: 'M6',
        lot_number: 'LOT-1',
        manufacture_date: '2024-01-01T00:00:00Z',
        expiry_date: '2025-01-01T00:00:00Z',
        quantity_remaining: 50,
      },
    ])
    const res = await POST(makeReq({ batch_ids: ['b1', null, ''] }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/batch-labels-1\.pdf/)
    // filter(Boolean) removes null and ''
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [['b1']])
    expect(mockBatchPdf).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          batchId: 'bid1',
          lotNumber: 'LOT-1',
          manufactureDate: '2024-01-01',
          expiryDate: '2025-01-01',
          quantity: 50,
        }),
      ],
      1,
      false,
      undefined
    )
  })

  it('maps null manufacture/expiry dates and null quantity', async () => {
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid2',
        product_name: 'Nut',
        sku: 'N1',
        variant_name: null,
        lot_number: null,
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: null,
      },
    ])
    const res = await POST(makeReq({ batch_ids: ['b2'] }))
    expect(res.status).toBe(200)
    expect(mockBatchPdf).toHaveBeenCalledWith(
      [expect.objectContaining({ manufactureDate: null, expiryDate: null, quantity: null })],
      1,
      false,
      undefined
    )
  })

  it('returns 404 when no batches found', async () => {
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makeReq({ batch_ids: ['b1'] }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/No batches/)
  })
})

describe('POST /api/admin/labels/batch — batch mode (batches[] with counts)', () => {
  it('expands count per batch and clamps count between 1 and 9999', async () => {
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid1',
        product_name: 'Bolt',
        sku: 'B1',
        variant_name: null,
        lot_number: 'L1',
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: 3,
      },
      {
        batch_id: 'bid2',
        product_name: 'Nut',
        sku: 'N1',
        variant_name: null,
        lot_number: 'L2',
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: 5,
      },
    ])
    const res = await POST(
      makeReq({
        batches: [
          { id: 'bid1', count: 3 },
          { id: 'bid2', count: 0 }, // clamps to 1
          { notId: true }, // filtered out (no string id)
        ],
      })
    )
    expect(res.status).toBe(200)
    // bid1 → 3 copies, bid2 → 1 copy = 4 total
    const call = mockBatchPdf.mock.calls[0]
    expect(call[0]).toHaveLength(4)
    expect(res.headers.get('Content-Disposition')).toMatch(/batch-labels-4\.pdf/)
  })

  it('defaults count to 1 when a batch row has no matching count entry', async () => {
    // batches[] references bid1 only, but query returns an extra row bid9
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid1',
        product_name: 'A',
        sku: 'A1',
        variant_name: null,
        lot_number: null,
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: null,
      },
      {
        batch_id: 'bid9',
        product_name: 'B',
        sku: 'B1',
        variant_name: null,
        lot_number: null,
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: null,
      },
    ])
    const res = await POST(makeReq({ batches: [{ id: 'bid1', count: 2 }] }))
    expect(res.status).toBe(200)
    // bid1 → 2, bid9 → default 1 = 3 total
    expect(mockBatchPdf.mock.calls[0][0]).toHaveLength(3)
  })
})

describe('POST /api/admin/labels/batch — copies clamping & errors', () => {
  it('clamps copies to max 100', async () => {
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid1',
        product_name: 'A',
        sku: 'A1',
        variant_name: null,
        lot_number: null,
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: null,
      },
    ])
    await POST(makeReq({ batch_ids: ['b1'], copies: 9999 }))
    expect(mockBatchPdf).toHaveBeenCalledWith(expect.any(Array), 100, false, undefined)
  })

  it('clamps copies to min 1 for invalid/negative values', async () => {
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid1',
        product_name: 'A',
        sku: 'A1',
        variant_name: null,
        lot_number: null,
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: null,
      },
    ])
    await POST(makeReq({ batch_ids: ['b1'], copies: 'abc' }))
    expect(mockBatchPdf).toHaveBeenCalledWith(expect.any(Array), 1, false, undefined)
  })

  it('ignores non-string size (stays undefined)', async () => {
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid1',
        product_name: 'A',
        sku: 'A1',
        variant_name: null,
        lot_number: null,
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: null,
      },
    ])
    await POST(makeReq({ batch_ids: ['b1'], size: 123 }))
    expect(mockBatchPdf).toHaveBeenCalledWith(expect.any(Array), 1, false, undefined)
  })

  it('returns 500 when PDF generation throws (with message)', async () => {
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid1',
        product_name: 'A',
        sku: 'A1',
        variant_name: null,
        lot_number: null,
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: null,
      },
    ])
    mockBatchPdf.mockRejectedValue(new Error('boom'))
    const res = await POST(makeReq({ batch_ids: ['b1'] }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('boom')
  })

  it('returns 500 with fallback message when error has no message', async () => {
    mockQueryMany.mockResolvedValue([
      {
        batch_id: 'bid1',
        product_name: 'A',
        sku: 'A1',
        variant_name: null,
        lot_number: null,
        manufacture_date: null,
        expiry_date: null,
        quantity_remaining: null,
      },
    ])
    mockBatchPdf.mockRejectedValue({})
    const res = await POST(makeReq({ batch_ids: ['b1'] }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Label generation failed')
  })
})
