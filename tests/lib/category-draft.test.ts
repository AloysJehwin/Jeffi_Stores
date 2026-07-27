import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQueryOne = vi.fn()
const mockQuery = vi.fn()
const mockClientQuery = vi.fn()
const mockWithTransaction = vi.fn()

vi.mock('@/lib/db', () => ({
  queryOne: (...a: any[]) => mockQueryOne(...a),
  query: (...a: any[]) => mockQuery(...a),
  withTransaction: (...a: any[]) => mockWithTransaction(...a),
}))

import { publishCategoryDraft } from '@/lib/category-draft'

describe('publishCategoryDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when no draft found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(publishCategoryDraft('cat-1')).rejects.toThrow('No draft to publish')
  })

  it('runs transaction when draft exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ category_id: 'cat-1', fields: { name: 'Electronics', is_active: true } })
    mockQueryOne.mockResolvedValueOnce({ is_active: true }) // prevIsActive
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockResolvedValue({ rows: [] })

    await publishCategoryDraft('cat-1')

    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    expect(mockClientQuery).toHaveBeenCalled()
  })

  it('cascades is_active change when it differs', async () => {
    mockQueryOne.mockResolvedValueOnce({ category_id: 'cat-1', fields: { name: 'Cat', is_active: false } })
    mockQueryOne.mockResolvedValueOnce({ is_active: true }) // was active, now false
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockResolvedValue({ rows: [{ id: 'sub-1' }] })

    await publishCategoryDraft('cat-1')

    // UPDATE products + UPDATE subcategories should be called
    const calls = mockClientQuery.mock.calls.map(([sql]: [string]) => sql)
    const hasProductUpdate = calls.some(s => s.includes('UPDATE products'))
    expect(hasProductUpdate).toBe(true)
  })
})
