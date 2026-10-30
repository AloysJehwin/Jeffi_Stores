import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  categoryFor: vi.fn(),
}))

import { createAutoTask, completeAutoTask, __resetSuperAdminCache } from '@/lib/shared/auto-tasks'
import { query, queryOne } from '@/lib/shared/db'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)

describe('createAutoTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetSuperAdminCache()
  })

  it('returns null when DB insert fails', async () => {
    mockQueryOne.mockResolvedValue(null) // no super admin
    mockQuery.mockRejectedValue(new Error('db error'))
    const result = await createAutoTask({
      userId: 'user-1',
      sourceKind: 'review_return',
      sourceRefId: 'ref-1',
      title: 'Test task',
    })
    expect(result).toBeNull()
  })

  it('returns null when no rows are inserted (duplicate guard)', async () => {
    mockQueryOne.mockResolvedValue({ id: 'admin-1' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)
    const result = await createAutoTask({
      userId: 'user-1',
      sourceKind: 'winback',
      sourceRefId: 'ref-2',
      title: 'Winback task',
    })
    expect(result).toBeNull()
  })

  it('returns taskId when insert succeeds', async () => {
    mockQueryOne.mockResolvedValue({ id: 'admin-1' })
    mockQuery.mockResolvedValue({ rows: [{ id: 'task-123' }], rowCount: 1 } as any)
    const result = await createAutoTask({
      userId: 'user-1',
      sourceKind: 'b2b_welcome',
      sourceRefId: 'ref-3',
      title: 'B2B welcome',
      priority: 'high',
      dueInDays: 3,
    })
    expect(result).toBe('task-123')
  })

  it('passes null dueDate when dueInDays is null', async () => {
    mockQueryOne.mockResolvedValue({ id: 'admin-1' })
    mockQuery.mockResolvedValue({ rows: [{ id: 'task-456' }], rowCount: 1 } as any)
    const result = await createAutoTask({
      userId: 'user-1',
      sourceKind: 'lead_followup',
      sourceRefId: 'ref-4',
      title: 'Follow up',
      dueInDays: null,
    })
    expect(result).toBe('task-456')
    const callArgs = mockQuery.mock.calls[0][1] as any[]
    // dueDate param (index 5) should be null
    expect(callArgs[5]).toBeNull()
  })

  it('truncates title to 255 chars', async () => {
    mockQueryOne.mockResolvedValue({ id: 'admin-1' })
    mockQuery.mockResolvedValue({ rows: [{ id: 'task-789' }], rowCount: 1 } as any)
    const longTitle = 'A'.repeat(300)
    await createAutoTask({
      userId: 'user-1',
      sourceKind: 'vip_check_in',
      sourceRefId: 'ref-5',
      title: longTitle,
    })
    const callArgs = mockQuery.mock.calls[0][1] as any[]
    expect((callArgs[3] as string).length).toBe(255)
  })
})

describe('completeAutoTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves without error even when DB throws', async () => {
    mockQuery.mockRejectedValue(new Error('db error'))
    await expect(completeAutoTask('review_return', 'ref-1')).resolves.toBeUndefined()
  })

  it('resolves normally when no tasks match', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)
    await expect(completeAutoTask('stuck_processing', 'ref-2')).resolves.toBeUndefined()
  })

  it('calls logActivity for each completed task', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'task-1', user_id: 'user-1', title: 'Some task' }],
      rowCount: 1,
    } as any)
    const { logActivity } = await import('@/lib/shared/activity')
    await completeAutoTask('ndr_check', 'ref-3', { actorAdminId: 'admin-2' })
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        kind: 'task_completed',
      })
    )
  })
})
