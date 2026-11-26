import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockBackfill, mockRunWithTenantContext } = vi.hoisted(() => ({
  mockBackfill: vi.fn(),
  mockRunWithTenantContext: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
}))
vi.mock('@/lib/shared/embed-products', () => ({ backfillProductEmbeddings: mockBackfill }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: mockRunWithTenantContext }))

import { runStoreBackfill } from '@/lib/shared/embed-backfill-run'

describe('runStoreBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBackfill.mockImplementation(async (o: any) => {
      for (let i = 1; i <= 4; i++) o.onProgress(i, 4)
      return { total: 4, embedded: 3, skipped: 1, failed: 0 }
    })
  })

  it('passes --force through and reports progress and a summary per store', async () => {
    const log = vi.fn()
    const r = await runStoreBackfill('acme', { tenantId: 't1' } as any, { force: true, log })
    expect(r.embedded).toBe(3)
    expect(mockBackfill).toHaveBeenCalledWith(expect.objectContaining({ onlyMissing: true, force: true }))
    expect(mockRunWithTenantContext).toHaveBeenCalledOnce()
    const lines = log.mock.calls.map(c => c[0])
    expect(lines).toContain('[acme] 4/4 (100%)')
    expect(lines.at(-1)).toBe('[acme] total=4 embedded=3 skipped=1 failed=0 (forced)')
  })

  it('runs the flagship without a tenant context and without force by default', async () => {
    const log = vi.fn()
    await runStoreBackfill('flagship', null, { log })
    expect(mockRunWithTenantContext).not.toHaveBeenCalled()
    expect(mockBackfill).toHaveBeenCalledWith(expect.objectContaining({ force: undefined }))
    expect(log.mock.calls.at(-1)![0]).toBe('[flagship] total=4 embedded=3 skipped=1 failed=0')
  })
})
