import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@/app/api/admin/suppliers/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['inventory'] }

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/suppliers/sup-123')
}

const sampleSupplier = {
  id: 'sup-123',
  name: 'Acme Supplies',
  gstin: 'GST123',
  contact_name: 'Bob',
  phone: '9999999999',
  email: 'bob@acme.com',
  is_active: true,
}

const sampleStats = {
  po_count: 3,
  po_total: 15000,
  expense_count: 2,
  expense_total: 8000,
}

describe('GET /api/admin/suppliers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'sup-123' }) as any })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'sup-123' }) as any })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when supplier not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'sup-123' }) as any })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns supplier with stats, pos, and expenses on success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(sampleSupplier).mockResolvedValueOnce(sampleStats)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'po-1', po_number: 'PO-001' }])
      .mockResolvedValueOnce([{ id: 'exp-1', expense_number: 'EXP-001' }])

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'sup-123' }) as any })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.supplier.name).toBe('Acme Supplies')
    expect(body.supplier.po_count).toBe(3)
    expect(body.pos).toHaveLength(1)
    expect(body.expenses).toHaveLength(1)
  })

  it('returns empty arrays when queryMany returns null', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(sampleSupplier).mockResolvedValueOnce(sampleStats)
    mockQueryMany.mockResolvedValueOnce(null as any).mockResolvedValueOnce(null as any)

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'sup-123' }) as any })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pos).toEqual([])
    expect(body.expenses).toEqual([])
  })

  it('returns 500 on database error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB crash'))

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'sup-123' }) as any })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB crash')
  })
})
