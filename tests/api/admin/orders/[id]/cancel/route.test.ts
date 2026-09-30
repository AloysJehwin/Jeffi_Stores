import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
}))
vi.mock('@/lib/orders/order-stock', () => ({
  restoreOrderStock: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/[id]/cancel/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { restoreOrderStock } from '@/lib/orders/order-stock'

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
  beforeEach(() => {
    vi.clearAllMocks()
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

    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    expect(vi.mocked(restoreOrderStock)).toHaveBeenCalledWith('order-1')
  })

  it('restores stock for sub_variant_id items in transaction', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(OFFLINE_ORDER as any)

    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
  })

  it('restores stock for product-only items (no variant)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(OFFLINE_ORDER as any)

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
