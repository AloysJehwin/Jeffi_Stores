import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/shared/validate', () => ({
  parseBody: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/(admin)/admin/inventory/suppliers/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { parseBody } from '@/lib/shared/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ────────────────────────────────────────────────────────────────────

const admin = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: ['inventory'],
}

const supplierId = 'sup-uuid-1'
const routeParams = { params: Promise.resolve({ id: supplierId }) }

function makeGet() {
  return new NextRequest(`http://localhost/api/admin/inventory/suppliers/${supplierId}`)
}

function makePatch(body: unknown) {
  return new NextRequest(`http://localhost/api/admin/inventory/suppliers/${supplierId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleSupplier = {
  id: supplierId,
  name: 'Acme Supplies',
  gstin: 'GST123456',
  contact_name: 'John Doe',
  phone: '9876543210',
  email: 'contact@acme.com',
  address: '123 Main St',
  payment_terms: '30',
  notes: null,
  is_active: true,
  bank_name: null,
  account_number: null,
  ifsc: null,
  upi_id: null,
  po_count: 3,
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/inventory/suppliers/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/permissions/i)
  })

  it('returns 404 when supplier not found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Not found')
  })

  it('returns supplier when found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleSupplier as any)
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.supplier).toEqual(sampleSupplier)
    expect(data.supplier.id).toBe(supplierId)
  })

  it('returns 500 on db error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB timeout'))
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toMatch(/DB timeout/i)
  })
})

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/admin/inventory/suppliers/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatch({ name: 'New Name' }), routeParams as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch({ name: 'New Name' }), routeParams as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON body', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest(`http://localhost/api/admin/inventory/suppliers/${supplierId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await PATCH(req, routeParams as any)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'Validation failed' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)
    const res = await PATCH(makePatch({ email: 'not-an-email' }), routeParams as any)
    expect(res.status).toBe(422)
  })

  it('updates name successfully', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({
      ok: true,
      data: { name: 'Updated Name' },
    } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatch({ name: 'Updated Name' }), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE suppliers'),
      expect.arrayContaining(['Updated Name', supplierId])
    )
  })

  it('updates is_active field', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({
      ok: true,
      data: { is_active: false },
    } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatch({ is_active: false }), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('updates multiple fields at once', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        name: 'New Supplier',
        phone: '1234567890',
        email: 'new@supplier.com',
        gstin: 'NEWGST123',
        contact_name: 'Jane',
        address: '456 New St',
        payment_terms: '45',
        notes: 'Updated notes',
        bank_name: 'HDFC',
        account_number: '1234567890',
        ifsc: 'HDFC0001234',
        upi_id: 'supplier@upi',
        is_active: true,
      },
    } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(
      makePatch({
        name: 'New Supplier',
        phone: '1234567890',
        email: 'new@supplier.com',
      }),
      routeParams as any
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('handles null/falsy values in optional fields', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({
      ok: true,
      data: { gstin: null, notes: null },
    } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatch({ gstin: null }), routeParams as any)
    expect(res.status).toBe(200)
  })

  it('returns 500 on db error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({
      ok: true,
      data: { name: 'New Name' },
    } as any)
    mockQuery.mockRejectedValue(new Error('Connection refused'))

    const res = await PATCH(makePatch({ name: 'New Name' }), routeParams as any)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toMatch(/Connection refused/i)
  })
})
