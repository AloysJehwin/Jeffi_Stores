import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  getCustomers: vi.fn(),
}))

import { GET } from '@/app/api/customers/route'
import * as jwt from '@/lib/auth/jwt'
import * as scopes from '@/lib/auth/scopes'
import * as queries from '@/lib/queries'

const ADMIN = { adminId: 'admin-1', role: 'admin', scopes: [] }

function makeRequest(search = '') {
  return new Request(`http://localhost/api/customers${search}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/customers', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(scopes.hasScope).mockReturnValue(false)

    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 401 when authenticated but missing customers scope', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(false)

    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns customers list with defaults', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(queries.getCustomers).mockResolvedValue({ customers: [{ id: 'c1' }], total: 1 } as any)

    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.limit).toBe(50)
    expect(queries.getCustomers).toHaveBeenCalledWith({ search: undefined, status: undefined, page: 1, limit: 50 })
  })

  it('passes search/status/page/limit query params', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(queries.getCustomers).mockResolvedValue({ customers: [], total: 0 } as any)

    const res = await GET(makeRequest('?search=jane&status=active&page=2&limit=25') as any)
    expect(res.status).toBe(200)
    expect(queries.getCustomers).toHaveBeenCalledWith({ search: 'jane', status: 'active', page: 2, limit: 25 })
  })

  it('returns 500 when getCustomers throws', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(queries.getCustomers).mockRejectedValue(new Error('db error'))

    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/failed to fetch customers/i)
  })
})
