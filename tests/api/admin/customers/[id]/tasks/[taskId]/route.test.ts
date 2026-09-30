import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { PATCH, DELETE } from '@/app/api/admin/customers/[id]/tasks/[taskId]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { logActivity } from '@/lib/activity'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockLogActivity = vi.mocked(logActivity)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = {
  adminId: 'admin-1',
  username: 'testadmin',
  id: 'admin-uuid-1',
  role: 'super_admin',
  scopes: ['customers'],
}

function makePatch(customerId: string, taskId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/customers/${customerId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete(customerId: string, taskId: string) {
  return new NextRequest(`http://localhost/api/admin/customers/${customerId}/tasks/${taskId}`, {
    method: 'DELETE',
  })
}

const sampleTask = { status: 'pending', title: 'Follow up call' }

// ── Tests: PATCH ──────────────────────────────────────────────────────────────

describe('PATCH /api/admin/customers/[id]/tasks/[taskId]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatch('c1', 't1', {}), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch('c1', 't1', {}), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when task not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await PATCH(makePatch('c1', 't999', { title: 'New' }), {
      params: Promise.resolve({ id: 'c1', taskId: 't999' }),
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('updates title and returns success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleTask)
    mockQuery.mockResolvedValue(undefined as any)

    const res = await PATCH(makePatch('c1', 't1', { title: 'Updated title' }), {
      params: Promise.resolve({ id: 'c1', taskId: 't1' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE customer_tasks'),
      expect.arrayContaining(['Updated title'])
    )
  })

  it('updates description (trims and limits to 2000 chars)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleTask)
    mockQuery.mockResolvedValue(undefined as any)

    const longDesc = 'x'.repeat(2500)
    const res = await PATCH(makePatch('c1', 't1', { description: longDesc }), {
      params: Promise.resolve({ id: 'c1', taskId: 't1' }),
    })
    expect(res.status).toBe(200)
    const queryArgs = mockQuery.mock.calls[0][1] as any[]
    const descArg = queryArgs.find((a: any) => typeof a === 'string' && a.length === 2000)
    expect(descArg).toBeDefined()
  })

  it('clears description when empty string passed', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleTask)
    mockQuery.mockResolvedValue(undefined as any)

    await PATCH(makePatch('c1', 't1', { description: '' }), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })
    const queryArgs = mockQuery.mock.calls[0][1] as any[]
    expect(queryArgs).toContain(null)
  })

  it('updates valid priority', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleTask)
    mockQuery.mockResolvedValue(undefined as any)

    const res = await PATCH(makePatch('c1', 't1', { priority: 'high' }), {
      params: Promise.resolve({ id: 'c1', taskId: 't1' }),
    })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('priority'), expect.arrayContaining(['high']))
  })

  it('ignores invalid priority values', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleTask)
    mockQuery.mockResolvedValue(undefined as any)

    await PATCH(makePatch('c1', 't1', { priority: 'invalid_priority' }), {
      params: Promise.resolve({ id: 'c1', taskId: 't1' }),
    })
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).not.toContain('priority')
  })

  it('sets completed_at and completed_by when status=completed', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'pending', title: 'Do something' })
    mockQuery.mockResolvedValue(undefined as any)
    mockLogActivity.mockResolvedValue(undefined as any)

    const res = await PATCH(makePatch('c1', 't1', { status: 'completed' }), {
      params: Promise.resolve({ id: 'c1', taskId: 't1' }),
    })
    expect(res.status).toBe(200)
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain('completed_at = NOW()')
    expect(sql).toContain('completed_by')
  })

  it('logs activity when task transitions to completed', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'pending', title: 'Call customer' })
    mockQuery.mockResolvedValue(undefined as any)
    mockLogActivity.mockResolvedValue(undefined as any)

    await PATCH(makePatch('c1', 't1', { status: 'completed' }), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })

    // logActivity is fire-and-forget — give microtask queue a tick
    await new Promise(r => setTimeout(r, 0))
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'task_completed',
        userId: 'c1',
        referenceId: 't1',
      })
    )
  })

  it('clears completed_at when re-opening a completed task', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'completed', title: 'Old task' })
    mockQuery.mockResolvedValue(undefined as any)

    await PATCH(makePatch('c1', 't1', { status: 'in_progress' }), {
      params: Promise.resolve({ id: 'c1', taskId: 't1' }),
    })
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain('completed_at = NULL')
  })

  it('sets assigned_to null when falsy value passed', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleTask)
    mockQuery.mockResolvedValue(undefined as any)

    await PATCH(makePatch('c1', 't1', { assigned_to: '' }), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })
    const queryArgs = mockQuery.mock.calls[0][1] as any[]
    expect(queryArgs).toContain(null)
  })

  it('sets due_date to null when empty string passed', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleTask)
    mockQuery.mockResolvedValue(undefined as any)

    await PATCH(makePatch('c1', 't1', { due_date: '' }), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })
    const queryArgs = mockQuery.mock.calls[0][1] as any[]
    expect(queryArgs).toContain(null)
  })
})

// ── Tests: DELETE ─────────────────────────────────────────────────────────────

describe('DELETE /api/admin/customers/[id]/tasks/[taskId]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeDelete('c1', 't1'), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDelete('c1', 't1'), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })
    expect(res.status).toBe(403)
  })

  it('deletes the task and returns success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue(undefined as any)

    const res = await DELETE(makeDelete('c1', 't1'), { params: Promise.resolve({ id: 'c1', taskId: 't1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM customer_tasks'), ['t1', 'c1'])
  })
})
