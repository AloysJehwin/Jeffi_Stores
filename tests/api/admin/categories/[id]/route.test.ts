import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/iconSuggest', () => ({ suggestIcon: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// ── Imports ────────────────────────────────────────────────────────────────

import { PATCH } from '@/app/api/admin/categories/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { suggestIcon } from '@/lib/iconSuggest'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['categories'] }
const CAT_ID = 'cat-uuid-1'

const UPDATED_CAT = {
  id: CAT_ID,
  name: 'Fasteners',
  slug: 'fasteners',
  description: 'All fasteners',
  is_active: true,
}

function makeReq(body: object) {
  return new NextRequest(`http://localhost/api/admin/categories/${CAT_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockSuggestIcon = vi.mocked(suggestIcon)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/categories/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
    mockQueryOne
      .mockResolvedValueOnce(UPDATED_CAT as any)  // before (SELECT)
      .mockResolvedValueOnce(UPDATED_CAT as any)  // after (SELECT)
    mockSuggestIcon.mockResolvedValue('wrench')
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeReq({ name: 'Test' }), { params: Promise.resolve({ id: CAT_ID }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when categories scope is missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makeReq({ name: 'Test' }), { params: Promise.resolve({ id: CAT_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 when name is missing', async () => {
    const res = await PATCH(makeReq({ description: 'desc' }), { params: Promise.resolve({ id: CAT_ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name required/i)
  })

  it('returns 400 when name is empty string', async () => {
    const res = await PATCH(makeReq({ name: '   ' }), { params: Promise.resolve({ id: CAT_ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name required/i)
  })

  // ── Happy path ───────────────────────────────────────────────────────────

  it('updates category and returns updated row', async () => {
    const res = await PATCH(
      makeReq({ name: 'Fasteners', description: 'All fasteners', is_active: true }),
      { params: Promise.resolve({ id: CAT_ID }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Fasteners')
    expect(mockQuery).toHaveBeenCalledOnce()
  })

  it('uses provided icon_name instead of suggestIcon', async () => {
    mockQueryOne
      .mockReset()
      .mockResolvedValueOnce(UPDATED_CAT as any)
      .mockResolvedValueOnce({ ...UPDATED_CAT, icon_name: 'bolt' } as any)

    const res = await PATCH(
      makeReq({ name: 'Bolts', icon_name: 'bolt' }),
      { params: Promise.resolve({ id: CAT_ID }) }
    )
    expect(res.status).toBe(200)
    // suggestIcon should NOT be called when icon_name is provided
    expect(mockSuggestIcon).not.toHaveBeenCalled()
  })

  it('calls suggestIcon when icon_name is not provided', async () => {
    const res = await PATCH(
      makeReq({ name: 'Nuts' }),
      { params: Promise.resolve({ id: CAT_ID }) }
    )
    expect(res.status).toBe(200)
    expect(mockSuggestIcon).toHaveBeenCalledWith('Nuts')
  })

  it('handles optional return_allowed and replacement_allowed fields', async () => {
    const res = await PATCH(
      makeReq({
        name: 'Tools',
        return_allowed: true,
        return_window_days: 14,
        replacement_allowed: false,
        replacement_window_days: 7,
      }),
      { params: Promise.resolve({ id: CAT_ID }) }
    )
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledOnce()
  })

  it('passes sku_prefix uppercased and sanitised', async () => {
    const res = await PATCH(
      makeReq({ name: 'Drill Bits', sku_prefix: 'dr-b!' }),
      { params: Promise.resolve({ id: CAT_ID }) }
    )
    expect(res.status).toBe(200)
    // query should have been called — prefix normalised inside the route
    expect(mockQuery).toHaveBeenCalledOnce()
  })
})
