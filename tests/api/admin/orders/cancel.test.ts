import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/[id]/cancel/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['orders'] }
const PARAMS = { params: Promise.resolve({ id: 'order-1' }) }

function makePost() {
  return new NextRequest('http://localhost/api/admin/orders/order-1/cancel', {
    method: 'POST',
  })
}

const OFFLINE_ORDER = {
  id: 'order-1',
  order_number: 'OFF-001',
  status: 'pending',
  payment_status: 'pending',
  source: 'offline',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/orders/[id]/cancel', () => {
  beforeEach(() => { vi.clearAllMocks() })

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

  it('returns 404 when order not found', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Order not found' })
  })

  it('returns 400 when order is not from offline source', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ ...OFFLINE_ORDER, source: 'website' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Only offline invoices can be cancelled from here' })
  })

  it('returns 400 when order is already cancelled', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ ...OFFLINE_ORDER, status: 'cancelled' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invoice is already cancelled' })
  })

  it('cancels order via transaction and returns success', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(OFFLINE_ORDER as any)

    // Simulate withTransaction executing the callback with a mock client
    vi.mocked(withTransaction).mockImplementation(async (cb) => {
      const mockClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT') && sql.includes('order_items')) {
            return {
              rows: [
                {
                  product_id: 'p1',
                  variant_id: 'v1',
                  sub_variant_id: null,
                  quantity: '2',
                },
              ],
            }
          }
          if (sql.includes('product_variants')) {
            return { rows: [{ inventory_quantity: '10' }] }
          }
          return { rows: [] }
        }),
      }
      return cb(mockClient as any)
    })

    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    expect(vi.mocked(withTransaction)).toHaveBeenCalled()
  })

  it('restores stock for sub_variant_id items in transaction', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(OFFLINE_ORDER as any)

    vi.mocked(withTransaction).mockImplementation(async (cb) => {
      const mockClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('order_items')) {
            return {
              rows: [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1', quantity: '3' }],
            }
          }
          if (sql.includes('product_sub_variants')) {
            return { rows: [{ inventory_quantity: '5' }] }
          }
          return { rows: [] }
        }),
      }
      return cb(mockClient as any)
    })

    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
  })

  it('restores stock for product-only items (no variant)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(OFFLINE_ORDER as any)

    vi.mocked(withTransaction).mockImplementation(async (cb) => {
      const mockClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('order_items')) {
            return {
              rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '1' }],
            }
          }
          if (sql.includes('FROM products')) {
            return { rows: [{ inventory_quantity: '20' }] }
          }
          return { rows: [] }
        }),
      }
      return cb(mockClient as any)
    })

    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockRejectedValue(new Error('unexpected db failure'))
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'unexpected db failure' })
  })
})
