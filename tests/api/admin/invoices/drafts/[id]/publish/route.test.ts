import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/invoices/drafts/[id]/publish/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, withTransaction } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockWithTransaction = vi.mocked(withTransaction)

const admin = { adminId: 'admin-1', role: 'super_admin', scopes: ['invoices:write'] }

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/invoices/drafts/draft-1/publish', {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid' },
  })
}

const params = { params: Promise.resolve({ id: 'draft-1' }) }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/invoices/drafts/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Insufficient permissions')
  })

  it('returns 404 when amendment draft not found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Amendment draft not found')
  })

  it('returns 404 when original invoice not found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'draft-1', draft_of_id: 'orig-1' }) // draft
      .mockResolvedValueOnce(null) // original
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Original invoice not found')
  })

  it('publishes the amendment: updates original, replaces items, deletes draft', async () => {
    mockAuth.mockResolvedValue(admin as any)
    const draft = {
      id: 'draft-1',
      draft_of_id: 'orig-1',
      total_amount: 100,
      subtotal: 90,
      tax_amount: 10,
      discount_amount: 0,
      taxable_amount: 90,
      cgst_amount: 5,
      sgst_amount: 5,
      igst_amount: 0,
      notes: 'amended',
    }
    const original = { id: 'orig-1' }
    mockQueryOne.mockResolvedValueOnce(draft as any).mockResolvedValueOnce(original as any)

    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 })
    mockWithTransaction.mockImplementation(async (cb: any) => cb({ query: clientQuery }))

    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.orderId).toBe('orig-1')

    // UPDATE original, DELETE original items, INSERT copied items, DELETE draft
    expect(clientQuery).toHaveBeenCalledTimes(4)
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE orders SET'),
      expect.arrayContaining([100, 'orig-1'])
    )
    expect(clientQuery).toHaveBeenNthCalledWith(4, expect.stringContaining('DELETE FROM orders WHERE id = $1'), [
      'draft-1',
    ])
  })

  it('returns 500 with the error message when the transaction throws', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'draft-1', draft_of_id: 'orig-1' } as any)
      .mockResolvedValueOnce({ id: 'orig-1' } as any)
    mockWithTransaction.mockRejectedValue(new Error('db exploded'))

    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('db exploded')
  })

  it('returns 500 with fallback message when the error has no message', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryOne.mockRejectedValueOnce({})
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Internal server error')
  })
})
