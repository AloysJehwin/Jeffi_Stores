import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { queryMock, queryManyMock, queryCountMock, authenticateAdminMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryManyMock: vi.fn(),
  queryCountMock: vi.fn(),
  authenticateAdminMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: queryMock,
  queryOne: vi.fn(),
  queryMany: queryManyMock,
  queryCount: queryCountMock,
}))

vi.mock('@/lib/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const { hasScope } = await vi.importActual<typeof import('@/lib/scopes')>('@/lib/scopes')
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
import { GET as listCategories, OPTIONS } from '@/app/api/categories/route'
import { DELETE as deleteCategory } from '@/app/api/categories/[id]/route'

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq(method: string) {
  return new Request('http://localhost/api/categories', {
    method,
    headers: { Authorization: 'Bearer mock-token' },
  })
}

const adminPayload = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['categories:write'] }

const sampleCategories = [
  { id: 'cat-1', name: 'Bolts', slug: 'bolts', parent_category_id: null, image_url: null, display_order: 1 },
  { id: 'cat-2', name: 'Nuts', slug: 'nuts', parent_category_id: null, image_url: null, display_order: 2 },
  { id: 'cat-3', name: 'Hex Bolts', slug: 'hex-bolts', parent_category_id: 'cat-1', image_url: null, display_order: 1 },
]

describe('GET /api/categories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns list of active categories', async () => {
    queryManyMock.mockResolvedValue(sampleCategories)

    const res = await listCategories(makeReq('GET') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('categories')
    expect(body.categories).toHaveLength(3)
  })

  it('returns categories with expected fields', async () => {
    queryManyMock.mockResolvedValue(sampleCategories)

    const res = await listCategories(makeReq('GET') as any)
    const body = await res.json()

    const cat = body.categories[0]
    expect(cat).toHaveProperty('id')
    expect(cat).toHaveProperty('name')
    expect(cat).toHaveProperty('slug')
    expect(cat).toHaveProperty('parent_category_id')
    expect(cat).toHaveProperty('display_order')
  })

  it('returns empty array when no categories exist', async () => {
    queryManyMock.mockResolvedValue([])

    const res = await listCategories(makeReq('GET') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.categories).toEqual([])
  })

  it('returns empty array when db returns null', async () => {
    queryManyMock.mockResolvedValue(null)

    const res = await listCategories(makeReq('GET') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.categories).toEqual([])
  })

  it('does not require authentication (public endpoint)', async () => {
    queryManyMock.mockResolvedValue(sampleCategories)

    const res = await listCategories(makeReq('GET') as any)
    expect(res.status).toBe(200)
  })
})

describe('OPTIONS /api/categories', () => {
  it('returns 204', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
  })
})

describe('DELETE /api/categories/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminMock.mockResolvedValue(adminPayload)
  })

  it('returns 401 when not authenticated', async () => {
    authenticateAdminMock.mockResolvedValue(null)

    const res = await deleteCategory(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'cat-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the admin lacks categories:write', async () => {
    authenticateAdminMock.mockResolvedValue({ ...adminPayload, role: 'viewer', scopes: ['categories:read'] })

    const res = await deleteCategory(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'cat-1' }) })
    expect(res.status).toBe(403)
  })

  it('deletes category with no products or sub-categories', async () => {
    queryCountMock
      .mockResolvedValueOnce(0) // products count
      .mockResolvedValueOnce(0) // sub-categories count
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 })

    const res = await deleteCategory(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'cat-2' }) })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 400 when category has products assigned', async () => {
    queryCountMock.mockResolvedValueOnce(5)

    const res = await deleteCategory(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'cat-1' }) })
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toMatch(/cannot delete category/i)
    expect(body.error).toMatch(/5 product/i)
  })

  it('returns 400 when category has sub-categories', async () => {
    queryCountMock
      .mockResolvedValueOnce(0) // products = 0
      .mockResolvedValueOnce(2) // sub-categories = 2

    const res = await deleteCategory(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'cat-1' }) })
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toMatch(/subcategor/i)
  })

  it('returns 500 when db throws', async () => {
    queryCountMock.mockRejectedValue(new Error('DB error'))

    const res = await deleteCategory(makeReq('DELETE') as any, { params: Promise.resolve({ id: 'cat-1' }) })
    expect(res.status).toBe(500)
  })
})
