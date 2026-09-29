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

vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shelf', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
  decrementNonPerishableShelfStock: vi.fn().mockResolvedValue(undefined),
}))

import { GET, PATCH } from '@/app/api/admin/cash-sale/[id]/detail/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTx = vi.mocked(withTransaction)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['invoices'] }

// params is a Promise in this route (newer Next.js)
const params = Promise.resolve({ id: 'sale-1' })

function makeGetReq() {
  return new NextRequest('http://localhost/api/admin/cash-sale/sale-1/detail')
}
function makePatchReq(body: any) {
  return new NextRequest('http://localhost/api/admin/cash-sale/sale-1/detail', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/cash-sale/[id]/detail', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when sale not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(404)
  })

  it('returns sale and items on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const sale = { id: 'sale-1', status: 'completed', total_amount: '500' }
    const items = [{ id: 'item-1', product_name: 'Bolt', quantity: 10 }]
    mockQueryOne.mockResolvedValue(sale)
    mockQueryMany.mockResolvedValue(items)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sale).toEqual(sale)
    expect(body.items).toEqual(items)
  })

  it('returns empty items array when no items exist', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sale-1', status: 'completed' })
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('db error'))
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/admin/cash-sale/[id]/detail', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatchReq({ action: 'cancel' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatchReq({ action: 'cancel' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 when action is not cancel', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makePatchReq({ action: 'complete' }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Unknown action/)
  })

  it('returns 500 when sale not found in transaction', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockWithTx.mockImplementation(async (fn: any) => {
      await fn({
        query: vi.fn().mockResolvedValue({ rows: [] }), // no rows for sale
      })
    })
    const res = await PATCH(makePatchReq({ action: 'cancel' }), { params })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Sale not found/)
  })

  it('returns 500 when sale already cancelled', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockWithTx.mockImplementation(async (fn: any) => {
      await fn({
        query: vi.fn().mockResolvedValue({ rows: [{ status: 'cancelled' }] }),
      })
    })
    const res = await PATCH(makePatchReq({ action: 'cancel' }), { params })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/already cancelled/)
  })

  it('cancels sale successfully and restores stock', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ status: 'completed' }] })  // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] })                          // UPDATE cash_sales
        .mockResolvedValueOnce({ rows: [                              // SELECT items
          { product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Bolt', variant_name: null, quantity: '5' }
        ]})
        .mockResolvedValueOnce({ rows: [] })                           // batchMovements query
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10 }] }) // SELECT products inventory
        .mockResolvedValueOnce({ rows: [] })                           // UPDATE products
        .mockResolvedValueOnce({ rows: [{ perishable: false, serialized: false }] }) // perishable check (sync loop)
        .mockResolvedValueOnce({ rows: [{ perishable: false, serialized: false }] }) // perishable check (restore loop)
        .mockResolvedValueOnce({ rows: [] })                           // UPDATE shelf_stock
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await PATCH(makePatchReq({ action: 'cancel' }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
