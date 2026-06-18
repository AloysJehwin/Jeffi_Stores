import { vi } from 'vitest'

export function makeDbMock() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  const queryOne = vi.fn().mockResolvedValue(null)
  const queryMany = vi.fn().mockResolvedValue([])
  const queryCount = vi.fn().mockResolvedValue(0)
  const withTransaction = vi.fn().mockImplementation(async (fn: any) => fn({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  }))
  const getClient = vi.fn()
  return { query, queryOne, queryMany, queryCount, withTransaction, getClient }
}

export const dbMock = makeDbMock()

vi.mock('@/lib/db', () => dbMock)
