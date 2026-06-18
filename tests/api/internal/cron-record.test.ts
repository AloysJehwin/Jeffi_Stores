import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { POST } from '@/app/api/internal/cron-record/route'
import { query, queryOne } from '@/lib/db'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)

function makeRequest(body: object, token?: string) {
  return new Request('http://localhost/api/internal/cron-record', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/cron-record', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('returns 503 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeRequest({ jobId: 'delhivery_sync', ok: true }) as any)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('Not configured')
  })

  it('returns 401 when authorization header is missing', async () => {
    const res = await POST(makeRequest({ jobId: 'delhivery_sync', ok: true }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization token is wrong', async () => {
    const res = await POST(makeRequest({ jobId: 'delhivery_sync', ok: true }, 'wrong-secret') as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid jobId', async () => {
    const res = await POST(makeRequest({ jobId: 'unknown_job', ok: true }, 'test-cron-secret') as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid jobId')
  })

  it('accepts all valid jobIds', async () => {
    const validIds = ['delhivery_sync', 'cancel_stale_orders', 'sweep_auto_tasks', 'run_campaigns', 'compute_health', 'daily_briefing']
    for (const jobId of validIds) {
      vi.clearAllMocks()
      mockQuery.mockResolvedValue(undefined as any)
      mockQueryOne.mockResolvedValue(null)
      const res = await POST(makeRequest({ jobId, ok: true }, 'test-cron-secret') as any)
      expect(res.status).toBe(200)
    }
  })

  it('upserts last_run, last_status, last_error settings and log on success', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    mockQueryOne.mockResolvedValue(null) // no existing log

    const res = await POST(makeRequest({ jobId: 'delhivery_sync', ok: true }, 'test-cron-secret') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    // 3 upserts + 1 log upsert = 4 query calls
    expect(mockQuery).toHaveBeenCalledTimes(4)
    // status should be 'ok'
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      ['cron_last_status_delhivery_sync', 'ok']
    )
    // error should be empty string on success
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      ['cron_last_error_delhivery_sync', '']
    )
  })

  it('sets status=error and stores errorMsg on failure', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    mockQueryOne.mockResolvedValue(null)

    await POST(makeRequest({ jobId: 'run_campaigns', ok: false, errorMsg: 'timeout' }, 'test-cron-secret') as any)

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      ['cron_last_status_run_campaigns', 'error']
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      ['cron_last_error_run_campaigns', 'timeout']
    )
  })

  it('prepends new entry to existing log and trims to 50', async () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({ t: `2024-01-${i + 1}`, ok: true }))
    mockQuery.mockResolvedValue(undefined as any)
    mockQueryOne.mockResolvedValue({ value: JSON.stringify(existing) })

    await POST(makeRequest({ jobId: 'compute_health', ok: true }, 'test-cron-secret') as any)

    // The last query call writes the log
    const calls = mockQuery.mock.calls
    const logCall = calls.find(c => (c[1] as any[])[0] === 'cron_log_compute_health')
    expect(logCall).toBeDefined()
    const stored = JSON.parse((logCall![1] as any[])[1])
    expect(stored).toHaveLength(50) // trimmed to 50
    expect(stored[0].ok).toBe(true) // newest first
  })

  it('handles corrupt existing log gracefully (resets to empty)', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    mockQueryOne.mockResolvedValue({ value: 'not-valid-json' })

    const res = await POST(makeRequest({ jobId: 'daily_briefing', ok: true }, 'test-cron-secret') as any)
    expect(res.status).toBe(200)
  })

  it('includes detail in log entry when provided', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    mockQueryOne.mockResolvedValue(null)

    await POST(makeRequest({ jobId: 'sweep_auto_tasks', ok: true, detail: { created: 5 } }, 'test-cron-secret') as any)

    const calls = mockQuery.mock.calls
    const logCall = calls.find(c => (c[1] as any[])[0] === 'cron_log_sweep_auto_tasks')
    const stored = JSON.parse((logCall![1] as any[])[1])
    expect(stored[0].detail).toEqual({ created: 5 })
  })
})
