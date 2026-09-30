import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rowCount: 0 }),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: vi.fn() }))

import { GET } from '@/app/api/cron/sweep-auto-tasks/route'
import { queryMany } from '@/lib/shared/db'
import { createAutoTask } from '@/lib/shared/auto-tasks'

const mockQueryMany = vi.mocked(queryMany)
const mockCreateAutoTask = vi.mocked(createAutoTask)

function makeRequest(auth?: string) {
  return new Request('http://localhost/api/cron/sweep-auto-tasks', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('GET /api/cron/sweep-auto-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('returns 401 without auth', async () => {
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong secret', async () => {
    const res = await GET(makeRequest('Bearer bad') as any)
    expect(res.status).toBe(401)
  })

  it('returns success with zero rows for every rule', async () => {
    // Called once per RULES entry (13 rules)
    mockQueryMany.mockResolvedValue([])
    mockCreateAutoTask.mockResolvedValue(null)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.totalCreated).toBe(0)
  })

  it('creates tasks for matched rows', async () => {
    mockQueryMany.mockResolvedValueOnce([{ user_id: 'u1', ref_id: 'r1', title: 'Task 1' }]).mockResolvedValue([])
    mockCreateAutoTask.mockResolvedValueOnce('task-id').mockResolvedValue(null)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.totalCreated).toBe(1)
    expect(mockCreateAutoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        sourceRefId: 'r1',
        title: 'Task 1',
      })
    )
  })

  it('collects errors per rule and returns them', async () => {
    mockQueryMany.mockRejectedValueOnce(new Error('db error')).mockResolvedValue([])

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.errors).toBeDefined()
    expect(json.errors[0]).toContain('db error')
  })

  it('does not include errors key when no errors occurred', async () => {
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.errors).toBeUndefined()
  })
})
