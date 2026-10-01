import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { queryMock, queryOneMock, queryManyMock, queryCountMock, authenticateAdminMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  queryManyMock: vi.fn(),
  queryCountMock: vi.fn(),
  authenticateAdminMock: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: queryMock,
  queryOne: queryOneMock,
  queryMany: queryManyMock,
  queryCount: queryCountMock,
}))

vi.mock('@/lib/auth/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const { hasScope } = await vi.importActual<typeof import('@/lib/auth/scopes')>('@/lib/auth/scopes')
  return {
    authenticateAdmin: authenticateAdminMock,
    authenticateUser: vi.fn().mockResolvedValue(null),
    requireAdminScope: async (_req: unknown, scope: string | null) => {
      const admin = await authenticateAdminMock()
      if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (scope && !hasScope(admin.role, admin.scopes, scope)) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }
      return admin
    },
  }
})

// ── import handlers AFTER mocks ──────────────────────────────────────────────
import { GET as listBrands, POST as createBrand } from '@/app/api/(public)/brands/route'
import { GET as getBrand, PATCH as patchBrand, DELETE as deleteBrand } from '@/app/api/(public)/brands/[id]/route'

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq(method: string, body?: Record<string, unknown>) {
  return new Request('http://localhost/api/brands', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-token' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const adminPayload = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['brands:write'] }
const sampleBrand = { id: 'brand-1', name: 'Unbrako', slug: 'unbrako', is_active: true }
const sampleBrandList = [sampleBrand, { id: 'brand-2', name: 'Fischer', slug: 'fischer', is_active: true }]

describe('GET /api/brands', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns list of active brands', async () => {
    queryManyMock.mockResolvedValue(sampleBrandList)

    const res = await listBrands(makeReq('GET') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('brands')
    expect(body.brands).toHaveLength(2)
    expect(body.brands[0]).toMatchObject({ id: 'brand-1', name: 'Unbrako' })
  })

  it('returns empty array when no brands exist', async () => {
    queryManyMock.mockResolvedValue([])

    const res = await listBrands(makeReq('GET') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.brands).toEqual([])
  })

  it('returns empty array when db returns null', async () => {
    queryManyMock.mockResolvedValue(null)

    const res = await listBrands(makeReq('GET') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.brands).toEqual([])
  })

  it('returns 500 when db throws', async () => {
    queryManyMock.mockRejectedValue(new Error('DB error'))

    const res = await listBrands(makeReq('GET') as any)
    expect(res.status).toBe(500)
  })
})

describe('POST /api/brands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminMock.mockResolvedValue(adminPayload)
  })

  it('returns 401 when not authenticated', async () => {
    authenticateAdminMock.mockResolvedValue(null)

    const res = await createBrand(makeReq('POST', { name: 'New Brand', slug: 'new-brand' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the admin lacks brands:write', async () => {
    authenticateAdminMock.mockResolvedValue({ ...adminPayload, role: 'viewer', scopes: ['brands:read'] })

    const res = await createBrand(makeReq('POST', { name: 'New Brand', slug: 'new-brand' }) as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 when name or slug is missing', async () => {
    const res = await createBrand(makeReq('POST', { name: 'Only Name' }) as any)
    expect(res.status).toBe(400)
  })

  it('creates brand and returns new id', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'new-brand-id' }], rowCount: 1 })

    const res = await createBrand(makeReq('POST', { name: 'New Brand', slug: 'new-brand' }) as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.id).toBe('new-brand-id')
  })

  it('returns 409 on duplicate slug (pg error 23505)', async () => {
    const pgError = Object.assign(new Error('duplicate'), { code: '23505' })
    queryMock.mockRejectedValue(pgError)

    const res = await createBrand(makeReq('POST', { name: 'Duplicate', slug: 'unbrako' }) as any)
    expect(res.status).toBe(409)
  })
})

describe('GET /api/brands/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminMock.mockResolvedValue(adminPayload)
  })

  it('returns brand when found', async () => {
    queryOneMock.mockResolvedValue(sampleBrand)

    const res = await getBrand(makeReq('GET') as any, { params: Promise.resolve({ id: 'brand-1' }) })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.brand).toMatchObject({ id: 'brand-1', name: 'Unbrako' })
  })

  it('returns 404 when brand not found', async () => {
    queryOneMock.mockResolvedValue(null)

    const res = await getBrand(makeReq('GET') as any, { params: Promise.resolve({ id: 'nonexistent' }) })
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 401 when not authenticated', async () => {
    authenticateAdminMock.mockResolvedValue(null)

    const res = await getBrand(makeReq('GET') as any, { params: Promise.resolve({ id: 'brand-1' }) })
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/brands/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminMock.mockResolvedValue(adminPayload)
  })

  it('updates brand successfully', async () => {
    queryOneMock.mockResolvedValue({ id: 'brand-1' })

    const res = await patchBrand(makeReq('PATCH', { name: 'Updated', slug: 'updated' }) as any, {
      params: Promise.resolve({ id: 'brand-1' }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 404 when brand not found during update', async () => {
    queryOneMock.mockResolvedValue(null)

    const res = await patchBrand(makeReq('PATCH', { name: 'X', slug: 'x' }) as any, {
      params: Promise.resolve({ id: 'nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when name or slug is missing', async () => {
    const res = await patchBrand(makeReq('PATCH', { name: 'Only Name' }) as any, {
      params: Promise.resolve({ id: 'brand-1' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/brands/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminMock.mockResolvedValue(adminPayload)
  })

  it('deletes brand with no products assigned', async () => {
    queryCountMock.mockResolvedValue(0)
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 })

    const res = await deleteBrand(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'brand-1' }) })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 400 when brand has products assigned', async () => {
    queryCountMock.mockResolvedValue(3)

    const res = await deleteBrand(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'brand-1' }) })
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toMatch(/cannot delete/i)
  })

  it('returns 401 when not authenticated', async () => {
    authenticateAdminMock.mockResolvedValue(null)

    const res = await deleteBrand(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'brand-1' }) })
    expect(res.status).toBe(401)
  })
})
