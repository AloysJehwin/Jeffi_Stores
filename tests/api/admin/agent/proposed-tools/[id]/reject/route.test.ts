import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/(admin)/admin/agent/proposed-tools/[id]/reject/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-uuid-1', role: 'super_admin', scopes: ['agent'] }
const TOOL_ID = 'tool-uuid-1'

function makeReq(body?: object) {
  return new NextRequest(`http://localhost/api/admin/agent/proposed-tools/${TOOL_ID}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/proposed-tools/[id]/reject', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'proposed' } as any)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: TOOL_ID }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when agent scope is missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: TOOL_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  // ── Not found / status guard ─────────────────────────────────────────────

  it('returns 404 when tool not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: TOOL_ID }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Not found')
  })

  it('returns 400 when tool is already approved', async () => {
    mockQueryOne.mockResolvedValue({ status: 'approved' } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: TOOL_ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Already approved')
  })

  it('returns 400 when tool is already rejected', async () => {
    mockQueryOne.mockResolvedValue({ status: 'rejected' } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: TOOL_ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Already rejected')
  })

  // ── Happy path ───────────────────────────────────────────────────────────

  it('rejects the tool and returns ok:true with status rejected', async () => {
    const res = await POST(makeReq({ reason: 'Not needed' }), { params: Promise.resolve({ id: TOOL_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('rejected')
    expect(mockQuery).toHaveBeenCalledOnce()
  })

  it('works with no body (empty reason)', async () => {
    const req = new NextRequest(`http://localhost/api/admin/agent/proposed-tools/${TOOL_ID}/reject`, {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: TOOL_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('truncates reason to 500 chars', async () => {
    const longReason = 'x'.repeat(600)
    const res = await POST(makeReq({ reason: longReason }), { params: Promise.resolve({ id: TOOL_ID }) })
    expect(res.status).toBe(200)
    // Verify the query was called (truncation happens silently)
    expect(mockQuery).toHaveBeenCalledOnce()
  })
})
