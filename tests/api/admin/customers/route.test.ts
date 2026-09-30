import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/queries', () => ({
  getCustomers: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/(admin)/admin/customers/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getCustomers } from '@/lib/queries'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGetCustomers = vi.mocked(getCustomers)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['customers'],
}

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/customers')
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v)
  }
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

const sampleCustomers = [
  {
    id: 'cust-1',
    first_name: 'Alice',
    last_name: 'Smith',
    email: 'alice@example.com',
    lifetime_value: 1500,
  },
  {
    id: 'cust-2',
    first_name: 'Bob',
    last_name: 'Jones',
    email: 'bob@example.com',
    lifetime_value: 800,
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/customers', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns paginated customer list', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetCustomers.mockResolvedValue({ customers: sampleCustomers } as any)

    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toHaveLength(2)
    expect(body.customers[0].email).toBe('alice@example.com')
  })

  it('passes segment filter to getCustomers', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetCustomers.mockResolvedValue({ customers: [sampleCustomers[0]] } as any)

    const req = makeRequest({ segment: 'high_value' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockGetCustomers).toHaveBeenCalledWith(expect.objectContaining({ segment: 'high_value' }))
  })

  it('passes limit parameter and caps at 100', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetCustomers.mockResolvedValue({ customers: sampleCustomers } as any)

    const req = makeRequest({ limit: '50' })
    await GET(req)
    expect(mockGetCustomers).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }))
  })

  it('caps limit at 100 even if more is requested', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetCustomers.mockResolvedValue({ customers: [] } as any)

    const req = makeRequest({ limit: '500' })
    await GET(req)
    expect(mockGetCustomers).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }))
  })

  it('sorts by lifetime_value descending by default', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetCustomers.mockResolvedValue({ customers: sampleCustomers } as any)

    const req = makeRequest()
    await GET(req)
    expect(mockGetCustomers).toHaveBeenCalledWith(expect.objectContaining({ sort: 'lifetime_value', dir: 'desc' }))
  })

  it('returns empty list when no customers found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetCustomers.mockResolvedValue({ customers: [] } as any)

    const req = makeRequest({ segment: 'nonexistent' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toEqual([])
  })
})
