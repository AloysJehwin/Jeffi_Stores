import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query }) }))

import { GET } from '@showcase/app/api/ready/route'

describe('GET /api/ready (showcase)', () => {
  beforeEach(() => {
    query.mockResolvedValue({ rows: [] })
  })

  it('is ready when the control plane answers', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', checks: { db: 'ok' } })
    expect(query).toHaveBeenCalledWith('SELECT 1')
  })

  it('503s when the control plane query fails', async () => {
    query.mockRejectedValue(new Error('refused'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'not_ready', checks: { db: 'fail: refused' } })
  })

  it('503s on a timeout', async () => {
    vi.useFakeTimers()
    try {
      query.mockReturnValue(new Promise(() => {}))
      const p = GET()
      await vi.advanceTimersByTimeAsync(3001)
      const res = await p
      expect(res.status).toBe(503)
      expect((await res.json()).checks.db).toContain('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})
