import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/customers/[id]/tasks/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockLogActivity = vi.mocked(logActivity)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['customers'],
}

const CUSTOMER_ID = 'user-uuid-123'

function makeGetRequest(id: string, searchParams: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/admin/customers/${id}/tasks`)
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

function makePostRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/customers/${id}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid-token' },
    body: JSON.stringify(body),
  })
}

const sampleTasks = [{ id: 'task-1', title: 'Follow up', status: 'pending', priority: 'high' }]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/customers/[id]/tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest(CUSTOMER_ID), { params: Promise.resolve({ id: CUSTOMER_ID }) })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetRequest(CUSTOMER_ID), { params: Promise.resolve({ id: CUSTOMER_ID }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns all tasks for a customer', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleTasks as any)
    const res = await GET(makeGetRequest(CUSTOMER_ID), { params: Promise.resolve({ id: CUSTOMER_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toEqual(sampleTasks)
  })

  it('filters open tasks when status=open', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleTasks as any)
    await GET(makeGetRequest(CUSTOMER_ID, { status: 'open' }), { params: Promise.resolve({ id: CUSTOMER_ID }) })
    const callArgs = mockQueryMany.mock.calls[0]
    expect(callArgs[0]).toContain("'pending', 'in_progress'")
  })

  it('filters completed tasks when status=completed', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    await GET(makeGetRequest(CUSTOMER_ID, { status: 'completed' }), { params: Promise.resolve({ id: CUSTOMER_ID }) })
    const callArgs = mockQueryMany.mock.calls[0]
    expect(callArgs[0]).toContain("'completed'")
  })

  it('returns empty tasks array when no tasks found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGetRequest(CUSTOMER_ID), { params: Promise.resolve({ id: CUSTOMER_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toEqual([])
  })
})

describe('POST /api/admin/customers/[id]/tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostRequest(CUSTOMER_ID, { title: 'Task' }), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostRequest(CUSTOMER_ID, { title: 'Task' }), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when title is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostRequest(CUSTOMER_ID, { description: 'No title' }), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/title is required/i)
  })

  it('returns 400 when title is blank string', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostRequest(CUSTOMER_ID, { title: '   ' }), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    })
    expect(res.status).toBe(400)
  })

  it('creates task and returns task id on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [{ id: 'task-new-1' }], rowCount: 1 } as any)
    const res = await POST(
      makePostRequest(CUSTOMER_ID, { title: 'Call customer', priority: 'high', due_date: '2026-07-01' }),
      { params: Promise.resolve({ id: CUSTOMER_ID }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.taskId).toBe('task-new-1')
  })

  it('defaults priority to medium for invalid priority value', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [{ id: 'task-2' }], rowCount: 1 } as any)
    await POST(makePostRequest(CUSTOMER_ID, { title: 'Task', priority: 'extreme' }), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    })
    const callArgs = mockQuery.mock.calls[0]
    expect(callArgs[1]).toContain('medium')
  })

  it('uses assigned_to from body when provided', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [{ id: 'task-3' }], rowCount: 1 } as any)
    await POST(makePostRequest(CUSTOMER_ID, { title: 'Task', assigned_to: 'other-admin-id' }), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    })
    const callArgs = mockQuery.mock.calls[0]
    expect(callArgs[1]).toContain('other-admin-id')
  })

  it('calls logActivity after task creation', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [{ id: 'task-4' }], rowCount: 1 } as any)
    mockLogActivity.mockResolvedValue(undefined)
    await POST(makePostRequest(CUSTOMER_ID, { title: 'Follow up call' }), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    })
    expect(mockLogActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task_created', userId: CUSTOMER_ID }))
  })
})

it('uses admin.adminId as assigned_to when not provided', async () => {
  mockAuth.mockResolvedValue(adminPayload)
  mockHasScope.mockReturnValue(true)
  mockQuery.mockResolvedValue({ rows: [{ id: 'task-x' }], rowCount: 1 } as any)
  await POST(makePostRequest(CUSTOMER_ID, { title: 'No assignee task' }), {
    params: Promise.resolve({ id: CUSTOMER_ID }),
  })
  const callArgs = mockQuery.mock.calls[0]!
  expect(callArgs[1]![2]).toBe(adminPayload.adminId)
})
