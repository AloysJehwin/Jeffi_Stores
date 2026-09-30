import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('amazon/asin-backfill no SELLER_ID', () => {
  beforeEach(() => vi.resetModules())

  it('returns empty report when SELLER_ID is not set', async () => {
    vi.doMock('@/lib/db', () => ({ query: vi.fn(), queryMany: vi.fn() }))
    vi.doMock('@/lib/amazon/client', () => ({
      matchAsin: vi.fn(),
      getSellerId: vi.fn().mockResolvedValue(''),
      amazonConfigured: vi.fn().mockResolvedValue(false),
    }))
    const db = await import('@/lib/db')
    const mod = await import('@/lib/amazon/asin-backfill')
    const rep = await mod.backfillAsins()
    expect(rep).toMatchObject({ scanned: 0, matched: 0, applied: 0, rows: [] })
    expect(vi.mocked(db.queryMany)).not.toHaveBeenCalled()
  })
})
