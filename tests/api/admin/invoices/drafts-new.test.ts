import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn().mockReturnValue(false),
  calculateGST: vi.fn().mockReturnValue({ taxableAmount: 80, cgst: 7.2, sgst: 7.2, igst: 0 }),
}))

vi.mock('@/lib/pricing', () => ({
  lineItemFromMrpIncl: vi.fn().mockReturnValue(100),
}))

import { GET, POST } from '@/app/api/admin/invoices/drafts/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, withTransaction } from '@/lib/db'
import { isInterState } from '@/lib/gst'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTx = vi.mocked(withTransaction)
const mockIsInterState = vi.mocked(isInterState)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['invoices'] }

function makeGetReq() {
  return new NextRequest('http://localhost/api/admin/invoices/drafts')
}
function makePostReq(body: any) {
  return new NextRequest('http://localhost/api/admin/invoices/drafts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/invoices/drafts', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(403)
  })

  it('returns drafts on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const drafts = [{ id: 'o1', order_number: 'DFT-001', customer_name: 'John' }]
    mockQueryMany.mockResolvedValue(drafts)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.drafts).toEqual(drafts)
  })

  it('returns 500 when queryMany throws', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockRejectedValue(new Error('DB connection lost'))
    const res = await GET(makeGetReq())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('DB connection lost')
  })
})

describe('POST /api/admin/invoices/drafts', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostReq({ customerName: 'John' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostReq({ customerName: 'John' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when customerName missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/customerName/)
  })

  it('creates draft order on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'addr-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'ord-1', order_number: 'DFT-123' }] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makePostReq({
      customerName: 'John Doe',
      customerPhone: '9999999999',
      items: [],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.draftId).toBe('ord-1')
  })

  it('processes line items and inserts order_items rows', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'addr-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'ord-1', order_number: 'DFT-456' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makePostReq({
      customerName: 'Jane',
      items: [
        { product_id: 'p1', product_name: 'Bolt', product_sku: 'B1', quantity: '2', unit_price: '100', gst_rate: '18' },
        { product_id: 'p2', product_name: 'Nut', product_sku: 'N1', quantity: '5', unit_price: '50', discount_pct: '10', gst_rate: '5' },
      ],
    }))
    expect(res.status).toBe(200)
    const itemInserts = mockClient.query.mock.calls.filter((args: any[]) =>
      typeof args[0] === 'string' && args[0].includes('INSERT INTO order_items')
    )
    expect(itemInserts).toHaveLength(2)
  })

  it('handles IGST path when buyerGstin and inter-state', async () => {
    mockIsInterState.mockReturnValueOnce(true)
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'addr-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'ord-2', order_number: 'DFT-789' }] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makePostReq({
      customerName: 'Corp Ltd',
      buyerGstin: '27AABCS1429B1Z5',
      state: 'Maharashtra',
      items: [
        { product_name: 'Item A', quantity: '1', unit_price: '200', gst_rate: '18' },
      ],
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('sets payment_status to unpaid when paymentMode is credit', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'addr-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'ord-3', order_number: 'DFT-CR1' }] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makePostReq({
      customerName: 'Credit Customer',
      paymentMode: 'credit',
      items: [],
    }))
    expect(res.status).toBe(200)
    const orderInsertCall = mockClient.query.mock.calls.find((args: any[]) =>
      typeof args[0] === 'string' && args[0].includes('INSERT INTO orders')
    )
    expect(orderInsertCall).toBeDefined()
    expect(orderInsertCall![1]).toContain('unpaid')
  })

  it('returns 500 on POST withTransaction error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockWithTx.mockRejectedValue(new Error('DB write failed'))
    const res = await POST(makePostReq({ customerName: 'John', items: [] }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('DB write failed')
  })
})
