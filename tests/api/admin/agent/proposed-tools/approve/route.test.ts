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

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/agent/proposed-tools/[id]/approve/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)

const superAdminPayload = {
  adminId: 'admin-super',
  username: 'superadmin',
  role: 'super_admin',
  scopes: ['agent'],
}

const regularAdminPayload = {
  adminId: 'admin-regular',
  username: 'regularadmin',
  role: 'admin',
  scopes: ['agent'],
}

function makeRequest(id = 'tool-1') {
  return new NextRequest(`http://localhost/api/admin/agent/proposed-tools/${id}/approve`, {
    method: 'POST',
    headers: { cookie: 'admin_token=valid' },
  })
}

const proposedTool = {
  id: 'tool-1',
  name: 'get_order',
  status: 'proposed',
  proposed_by_admin_id: 'admin-other',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/proposed-tools/[id]/approve', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params: { id: 'tool-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when agent scope is missing', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params: { id: 'tool-1' } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 403 when role is not super_admin', async () => {
    mockAuth.mockResolvedValue(regularAdminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest(), { params: { id: 'tool-1' } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/super_admin/i)
  })

  it('returns 404 when proposed tool not found', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeRequest('tool-999'), { params: { id: 'tool-999' } })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 400 when tool is not in proposed status', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...proposedTool, status: 'approved' })
    const res = await POST(makeRequest(), { params: { id: 'tool-1' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already approved/i)
  })

  it('returns 403 when approver is the same as proposer (separation of duties)', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({
      ...proposedTool,
      proposed_by_admin_id: 'admin-super', // same as approver
    })
    const res = await POST(makeRequest(), { params: { id: 'tool-1' } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/separation of duties/i)
  })

  it('approves the tool when all conditions are met', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(proposedTool)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makeRequest(), { params: { id: 'tool-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('approved')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'approved'"),
      expect.arrayContaining(['admin-super', 'tool-1']),
    )
  })
})
