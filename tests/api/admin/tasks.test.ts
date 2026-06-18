import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/tasks/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', role: 'super_admin', scopes: ['customers'] }

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/tasks')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const req = new NextRequest(url)
  // nextUrl.searchParams is needed by the route
  return req
}

const sampleTasks = [
  { id: 't1', title: 'Follow up', status: 'pending', priority: 'high', customer_email: 'c@example.com' },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns tasks list with default filters', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '1' })
    mockQueryMany.mockResolvedValue(sampleTasks as any)

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(25)
  })

  it('filters by scope=mine (uses admin.adminId)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '1' })
    mockQueryMany.mockResolvedValue(sampleTasks as any)

    await GET(makeGet({ scope: 'mine' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('assigned_to')
    const vals = mockQueryOne.mock.calls[0][1] as any[]
    expect(vals).toContain('admin-1')
  })

  it('filters by scope=unassigned', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ scope: 'unassigned' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('IS NULL')
  })

  it('filters by status=open (pending+in_progress)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '2' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ status: 'open' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain("'pending', 'in_progress'")
  })

  it('filters by status=completed', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '2' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ status: 'completed' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain("'completed'")
    expect(countSql).toContain('30 days')
  })

  it('filters by status=overdue', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ status: 'overdue' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('due_date < CURRENT_DATE')
  })

  it('filters by priority when not all', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '1' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ priority: 'urgent' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('priority')
    const vals = mockQueryOne.mock.calls[0][1] as any[]
    expect(vals).toContain('urgent')
  })

  it('filters by segment=orders uses KIND_SEGMENTS', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '3' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ segment: 'orders' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('source_kind')
    const vals = mockQueryOne.mock.calls[0][1] as any[]
    // The kinds array for 'orders' should be passed
    expect(vals.some(v => Array.isArray(v))).toBe(true)
  })

  it('filters by segment=manual', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '1' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ segment: 'manual' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('auto_created = false')
  })

  it('applies search filter to title and customer fields', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ search: 'john' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('ILIKE')
    const vals = mockQueryOne.mock.calls[0][1] as any[]
    expect(vals.some(v => typeof v === 'string' && v.includes('john'))).toBe(true)
  })

  it('returns correct pagination metadata', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '75' })
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeGet({ page: '2' }))
    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(25)
    expect(body.totalPages).toBe(3) // ceil(75/25)
  })

  it('uses no WHERE clause when no filters applied (scope=all status=all)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '10' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ scope: 'all', status: 'all', priority: 'all', segment: 'all' }))
    const countSql = mockQueryOne.mock.calls[0][0] as string
    // No WHERE conditions appended
    expect(countSql).not.toContain('WHERE')
  })
})
