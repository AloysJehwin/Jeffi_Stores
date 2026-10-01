import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/shared/customer-health', () => ({
  recomputeHealth: vi.fn(),
  getHealth: vi.fn(),
}))
vi.mock('@/lib/shared/auto-tasks', () => ({
  createAutoTask: vi.fn(),
  completeAutoTask: vi.fn(),
}))

import { GET } from '@/app/api/(internal)/cron/compute-health/route'
import { queryMany } from '@/lib/shared/db'
import { recomputeHealth, getHealth } from '@/lib/shared/customer-health'
import { createAutoTask, completeAutoTask } from '@/lib/shared/auto-tasks'

const mockQueryMany = vi.mocked(queryMany)
const mockRecomputeHealth = vi.mocked(recomputeHealth)
const mockGetHealth = vi.mocked(getHealth)
const mockCreateAutoTask = vi.mocked(createAutoTask)
const mockCompleteAutoTask = vi.mocked(completeAutoTask)

function makeRequest(auth?: string) {
  return new Request('http://localhost/api/cron/compute-health', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('GET /api/cron/compute-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('returns 401 without auth header', async () => {
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong secret', async () => {
    const res = await GET(makeRequest('Bearer wrong') as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 when CRON_SECRET not set', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(401)
  })

  it('returns success with no users', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.processed).toBe(0)
  })

  it('processes users and creates save_customer task for score < 25', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'u1' }])
    mockGetHealth.mockResolvedValueOnce({ score: 60 } as any)
    mockRecomputeHealth.mockResolvedValueOnce({
      score: 20,
      churn_risk: 'high',
      recency_score: 10,
      frequency_score: 10,
      monetary_score: 10,
      trend_delta_30d: -5,
    } as any)
    mockCreateAutoTask.mockResolvedValueOnce('task1')

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.processed).toBe(1)
    expect(json.dropTasksCreated).toBe(1)
    expect(mockCreateAutoTask).toHaveBeenCalledWith(expect.objectContaining({ priority: 'urgent' }))
  })

  it('creates task for rapid decline (trend_delta_30d <= -20)', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'u1' }])
    mockGetHealth.mockResolvedValueOnce({ score: 80 } as any)
    mockRecomputeHealth.mockResolvedValueOnce({
      score: 60,
      churn_risk: 'medium',
      recency_score: 40,
      frequency_score: 40,
      monetary_score: 40,
      trend_delta_30d: -25,
    } as any)
    mockCreateAutoTask.mockResolvedValueOnce('task1')

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.dropTasksCreated).toBe(1)
    expect(mockCreateAutoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('dropped 25 points'),
      })
    )
  })

  it('creates task for score crossing below 40', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'u1' }])
    mockGetHealth.mockResolvedValueOnce({ score: 50 } as any)
    mockRecomputeHealth.mockResolvedValueOnce({
      score: 38,
      churn_risk: 'medium',
      recency_score: 30,
      frequency_score: 30,
      monetary_score: 30,
      trend_delta_30d: -5,
    } as any)
    mockCreateAutoTask.mockResolvedValueOnce('task1')

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.dropTasksCreated).toBe(1)
    expect(mockCreateAutoTask).toHaveBeenCalledWith(expect.objectContaining({ priority: 'high' }))
  })

  it('completes auto task when user recovers above 50', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'u1' }])
    mockGetHealth.mockResolvedValueOnce({ score: 45 } as any)
    mockRecomputeHealth.mockResolvedValueOnce({
      score: 55,
      churn_risk: 'low',
      recency_score: 60,
      frequency_score: 60,
      monetary_score: 60,
      trend_delta_30d: 5,
    } as any)
    mockCompleteAutoTask.mockResolvedValueOnce(undefined)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.recoveredTasksCompleted).toBe(1)
    expect(mockCompleteAutoTask).toHaveBeenCalledWith('save_customer', 'u1')
  })

  it('handles recomputeHealth returning null', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'u1' }])
    mockGetHealth.mockResolvedValueOnce(null)
    mockRecomputeHealth.mockResolvedValueOnce(null)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.processed).toBe(0)
  })

  it('collects errors per user and returns them', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'u1' }])
    mockGetHealth.mockResolvedValueOnce(null)
    mockRecomputeHealth.mockRejectedValueOnce(new Error('health fail'))

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.errors).toEqual(expect.arrayContaining(['u1: health fail']))
  })
})
