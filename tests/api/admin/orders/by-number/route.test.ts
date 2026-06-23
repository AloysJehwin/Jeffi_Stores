import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))

import { GET } from '@/app/api/admin/orders/by-number/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['orders'] }

function makeRequest(q?: string) {
  const url = new URL('http://localhost/api/admin/orders/by-number')
  if (q !== undefined) url.searchParams.set('q', q)
  return new NextRequest(url.toString())
}

const sampleOrder = {
  id: 'order-123',
  order_number: 'ORD-2024-001',
  status: 'confirmed',
  payment_status: 'paid',
  customer_name: 'Alice Smith',
}

describe('GET /api/admin/orders/by-number', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest('ORD-001'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest('ORD-001'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 400 when q param is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/q is required/i)
  })

  it('returns 400 when q param is empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await GET(makeRequest(''))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/q is required/i)
  })

  it('returns order when found by order number', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)

    const res = await GET(makeRequest('ORD-2024-001'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.order_number).toBe('ORD-2024-001')
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), ['ORD-2024-001'])
  })

  it('trims whitespace from q param', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)

    await GET(makeRequest('  ORD-001  '))
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), ['ORD-001'])
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)

    const res = await GET(makeRequest('ORD-NOTEXIST'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })
})
