import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(),
}))

import { GET } from '@/app/api/admin/business/customers/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne, queryMany } from '@/lib/shared/db'

const mockRequireAdminScope = vi.mocked(requireAdminScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['business_customers'] }

function makeReq(id: string) {
  return new NextRequest(`http://localhost/api/admin/business/customers/${id}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/business/customers/[id]', () => {
  it('returns 401 when requireAdminScope returns NextResponse', async () => {
    const errResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    mockRequireAdminScope.mockResolvedValue(errResponse)
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ id: 'u1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when requireAdminScope returns 403 NextResponse', async () => {
    const errResponse = NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    mockRequireAdminScope.mockResolvedValue(errResponse)
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ id: 'u1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when customer not found', async () => {
    mockRequireAdminScope.mockResolvedValue(admin)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ id: 'u1' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('returns customer and discounts on happy path', async () => {
    mockRequireAdminScope.mockResolvedValue(admin)
    const customer = { id: 'u1', email: 'biz@x.com', company_name: 'ACME' }
    const discounts = [{ id: 'd1', category_id: 'c1', category_name: 'Bolts', discount_pct: 10 }]
    mockQueryOne.mockResolvedValue(customer)
    mockQueryMany.mockResolvedValue(discounts)
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ id: 'u1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customer).toEqual(customer)
    expect(body.discounts).toEqual(discounts)
  })
})
