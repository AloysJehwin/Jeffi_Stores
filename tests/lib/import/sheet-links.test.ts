import { describe, it, expect, vi, beforeEach } from 'vitest'

const cp = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => cp }))
vi.mock('@/lib/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/product-delete', () => ({ retireProduct: vi.fn() }))

import { forgetSheetOwnership, releaseSheetProducts } from '@/lib/import/sheet-links'
import { query } from '@/lib/db'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('forgetSheetOwnership', () => {
  it('clears pending removals and drops every sheet link, scoped to the tenant', async () => {
    cp.query.mockResolvedValueOnce({ rowCount: 2 }).mockResolvedValueOnce({ rowCount: 5 })
    expect(await forgetSheetOwnership('t1')).toBe(5)

    const [clearSql, clearArgs] = cp.query.mock.calls[0]
    expect(clearSql).toMatch(/UPDATE import_jobs SET pending_deletions = '\[\]'::jsonb/)
    expect(clearSql).toMatch(/tenant_id = \$1 AND source = 'google_sheet'/)
    expect(clearArgs).toEqual(['t1'])

    const [linkSql, linkArgs] = cp.query.mock.calls[1]
    expect(linkSql).toMatch(/DELETE FROM sheet_product_links WHERE tenant_id = \$1$/)
    expect(linkArgs).toEqual(['t1'])
  })
})

describe('releaseSheetProducts', () => {
  it('re-tags only sheet-synced products as manual', async () => {
    vi.mocked(query).mockResolvedValue({ rowCount: 4 } as any)
    expect(await releaseSheetProducts()).toBe(4)
    expect(vi.mocked(query).mock.calls[0][0]).toMatch(/SET data_source = 'manual' WHERE data_source = 'google_sheet'$/)
  })
})
