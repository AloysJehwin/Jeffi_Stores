import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQueryOne = vi.fn()
const mockQuery = vi.fn()
const mockClientQuery = vi.fn() as any
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
    mockQueryOne.mockResolvedValueOnce({ is_active: true })
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockResolvedValue({ rows: [] })
    await publishCategoryDraft('cat-1')
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    expect(mockClientQuery).toHaveBeenCalled()
  })

  it('generates null slug when name is missing', async () => {
    mockQueryOne.mockResolvedValueOnce({ category_id: 'cat-1', fields: { is_active: true } })
    mockQueryOne.mockResolvedValueOnce({ is_active: true })
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockResolvedValue({ rows: [] })
    await publishCategoryDraft('cat-1')
    const updateCall = mockClientQuery.mock.calls[0]
    expect(updateCall[1][2]).toBeNull()
  })

  it('handles all optional fields — display_order, sku_prefix, policy fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      category_id: 'cat-1',
      fields: {
        name: 'Cat',
        is_active: true,
        display_order: 5,
        sku_prefix: 'CA',
        policy_override: true,
        return_allowed: true,
        return_window_days: 7,
        replacement_allowed: false,
        replacement_window_days: 14,
        google_product_category: 'Electronics',
        icon_name: 'tag',
      },
    })
    mockQueryOne.mockResolvedValueOnce({ is_active: true })
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockResolvedValue({ rows: [] })
    await publishCategoryDraft('cat-1')
    const args = mockClientQuery.mock.calls[0][1]
    expect(args).toContain(5) // display_order parsed
    expect(args).toContain('CA') // sku_prefix
  })

  it('cascades is_active change to products and subcategories', async () => {
    mockQueryOne.mockResolvedValueOnce({ category_id: 'cat-1', fields: { name: 'Cat', is_active: false } })
    mockQueryOne.mockResolvedValueOnce({ is_active: true })
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE categories
      .mockResolvedValueOnce({ rows: [] }) // UPDATE products direct
      .mockResolvedValueOnce({ rows: [{ id: 'sub-1' }] }) // SELECT subcats
      .mockResolvedValueOnce({ rows: [] }) // UPDATE categories sub
      .mockResolvedValueOnce({ rows: [] }) // UPDATE products sub
      .mockResolvedValueOnce({ rows: [] }) // DELETE draft
    await publishCategoryDraft('cat-1')
    const productUpdates = mockClientQuery.mock.calls.filter(([sql]: [string]) => sql.includes('UPDATE products'))
    expect(productUpdates.length).toBeGreaterThan(0)
  })

  it('skips cascade when is_active unchanged', async () => {
    mockQueryOne.mockResolvedValueOnce({ category_id: 'cat-1', fields: { name: 'Cat', is_active: true } })
    mockQueryOne.mockResolvedValueOnce({ is_active: true })
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockResolvedValue({ rows: [] })
    await publishCategoryDraft('cat-1')
    const productUpdates = mockClientQuery.mock.calls.filter(([sql]: [string]) => sql.includes('UPDATE products'))
    expect(productUpdates.length).toBe(0)
  })

  it('skips cascade when is_active is null in fields', async () => {
    mockQueryOne.mockResolvedValueOnce({ category_id: 'cat-1', fields: { name: 'Cat' } })
    mockQueryOne.mockResolvedValueOnce({ is_active: true })
    mockWithTransaction.mockImplementation(async (fn: any) => {
      await fn({ query: mockClientQuery })
    })
    mockClientQuery.mockResolvedValue({ rows: [] })
    await publishCategoryDraft('cat-1')
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })
})
