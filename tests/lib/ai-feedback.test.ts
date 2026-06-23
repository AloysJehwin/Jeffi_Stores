import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryMany: vi.fn() }))

import { recordImplicitSignal, recordImplicitSignalsForProducts } from '@/lib/ai-feedback'
import * as db from '@/lib/db'

const mockQuery = db.query as ReturnType<typeof vi.fn>
const mockQueryMany = db.queryMany as ReturnType<typeof vi.fn>

describe('recordImplicitSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns early when userId is empty', async () => {
    await recordImplicitSignal('', 'p1', 'clicked')
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('returns early when productId is empty', async () => {
    await recordImplicitSignal('user-1', '', 'clicked')
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('returns early when no matching ai_query found', async () => {
    mockQueryMany.mockResolvedValueOnce([]) // no match
    await recordImplicitSignal('user-1', 'p1', 'clicked')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('inserts feedback when a match is found', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'q1' }])
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await recordImplicitSignal('user-1', 'p1', 'purchased')

    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO ai_feedback')
    expect(params[0]).toBe('q1')  // ai_query_id
    expect(params[1]).toBe('user-1')
    expect(params[2]).toBe('p1')
    expect(params[3]).toBe('purchased')
  })

  it('inserts with ON CONFLICT DO NOTHING for duplicates', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'q2' }])
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await recordImplicitSignal('user-1', 'p1', 'added_to_cart')

    const [sql] = mockQuery.mock.calls[0]
    expect(sql).toContain('ON CONFLICT DO NOTHING')
  })

  it('does not throw when query fails (silent catch)', async () => {
    mockQueryMany.mockRejectedValueOnce(new Error('DB error'))
    await expect(recordImplicitSignal('user-1', 'p1', 'clicked')).resolves.toBeUndefined()
  })

  it('passes all 3 signals: clicked, added_to_cart, purchased', async () => {
    for (const signal of ['clicked', 'added_to_cart', 'purchased'] as const) {
      vi.clearAllMocks()
      mockQueryMany.mockResolvedValueOnce([{ id: 'q-signal' }])
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await recordImplicitSignal('user-1', 'p1', signal)

      expect(mockQuery.mock.calls[0][1][3]).toBe(signal)
    }
  })

  it('passes ATTRIBUTION_WINDOW_HOURS (24) as third param to queryMany', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await recordImplicitSignal('user-1', 'p1', 'clicked')
    const [, params] = mockQueryMany.mock.calls[0]
    expect(params[2]).toBe(24)
  })
})

describe('recordImplicitSignalsForProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls recordImplicitSignal for each product', async () => {
    // 2 products, each with a match
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'q1' }])
      .mockResolvedValueOnce([{ id: 'q2' }])
    mockQuery.mockResolvedValue({ rows: [] })

    await recordImplicitSignalsForProducts('user-1', ['p1', 'p2'], 'clicked')

    expect(mockQueryMany).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('does nothing for empty productIds array', async () => {
    await recordImplicitSignalsForProducts('user-1', [], 'clicked')
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('processes products sequentially (still completes all)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'q1' }])
      .mockResolvedValueOnce([]) // no match for p2

    mockQuery.mockResolvedValue({ rows: [] })

    await recordImplicitSignalsForProducts('user-1', ['p1', 'p2'], 'purchased')
    expect(mockQueryMany).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenCalledTimes(1) // only p1 had a match
  })
})
