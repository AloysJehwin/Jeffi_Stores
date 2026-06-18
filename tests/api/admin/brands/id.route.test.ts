import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: { optional: vi.fn().mockReturnThis() },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { PATCH } from '@/app/api/admin/brands/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { parseBody } from '@/lib/validate'
import { NextResponse } from 'next/server'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockParseBody = vi.mocked(parseBody)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['categories'],
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/admin/brands/brand-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'admin_token=valid' },
    body: JSON.stringify(body),
  })
}

const updatedBrand = {
  id: 'brand-1',
  name: 'Nike',
  slug: 'nike',
  is_active: true,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/brands/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeRequest({ name: 'Nike' }), { params: { id: 'brand-1' } })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makeRequest({ name: 'Nike' }), { params: { id: 'brand-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makeRequest({ name: '' }), { params: { id: 'brand-1' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name required/i)
  })

  it('returns parseBody validation error when schema fails', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const errorResponse = { ok: false as const, response: NextResponse.json({ error: 'Validation failed' }, { status: 400 }) }
    mockParseBody.mockReturnValue(errorResponse)

    const res = await PATCH(makeRequest({ name: 'Nike', slug: '' }), { params: { id: 'brand-1' } })
    expect(res.status).toBe(400)
  })

  it('updates brand and returns updated record', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { name: 'Nike', slug: 'nike' } })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryOne.mockResolvedValue(updatedBrand)

    const res = await PATCH(
      makeRequest({ name: 'Nike', slug: 'nike', is_active: true }),
      { params: { id: 'brand-1' } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Nike')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE brands'),
      expect.any(Array),
    )
  })

  it('auto-generates slug from name when slug not provided', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { name: 'Nike Sport', slug: undefined } })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryOne.mockResolvedValue(updatedBrand)

    await PATCH(makeRequest({ name: 'Nike Sport' }), { params: { id: 'brand-1' } })

    const callArgs = mockQuery.mock.calls[0][1] as any[]
    expect(callArgs[1]).toBe('nike-sport')
  })
})
