import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ lookupTenantContextById: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: vi.fn() }))
vi.mock('@/lib/import/jobs', () => {
  class ImportBusyError extends Error {}
  return {
    getImportJob: vi.fn(),
    updateImportJob: vi.fn(),
    resolveImportTenantId: vi.fn(),
    latestJobBySource: vi.fn(),
    hasActiveSheetSync: vi.fn(),
    withImportLock: vi.fn(),
    isUuid: (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v),
    ImportBusyError,
    PLATFORM_TENANT_ID: 'platform',
  }
})
vi.mock('@/lib/import/sheet-links', () => ({ applyOrphanRemoval: vi.fn(), removeSheetLinks: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/data-source/google/reconcile/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { getImportJob, updateImportJob, resolveImportTenantId, latestJobBySource, hasActiveSheetSync, withImportLock, ImportBusyError } from '@/lib/import/jobs'
import { applyOrphanRemoval, removeSheetLinks } from '@/lib/import/sheet-links'

const JOB = '66666666-6666-4666-8666-666666666666'
const P1 = '77777777-7777-4777-8777-777777777771'
const P2 = '77777777-7777-4777-8777-777777777772'
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/data-source/google/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const job = (over: Record<string, unknown> = {}) => ({
  id: JOB,
  source: 'google_sheet',
  spreadsheet_id: 'sheet1',
  status: 'done',
  row_results: [],
  pending_deletions: [
    { productId: P1, sku: 'A', name: 'Alpha' },
    { productId: P2, sku: 'B', name: 'Beta' },
  ],
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue('t1')
  vi.mocked(withImportLock).mockImplementation((async (_t: any, _k: any, fn: any) => fn()) as any)
  vi.mocked(getImportJob).mockResolvedValue(job() as any)
  vi.mocked(latestJobBySource).mockResolvedValue({ id: JOB } as any)
  vi.mocked(hasActiveSheetSync).mockResolvedValue(false as any)
  vi.mocked(lookupTenantContextById).mockResolvedValue({ slug: 'shop' } as any)
  vi.mocked(runWithTenantContext).mockImplementation((async (_c: any, fn: any) => fn()) as any)
  vi.mocked(applyOrphanRemoval).mockResolvedValue([{ sku: 'A', name: 'Alpha', action: 'deleted' }] as any)
})

describe('POST /api/admin/data-source/google/reconcile', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req({}))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req({}))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:write')
  })

  it('returns 400 for a bad job id, decision or product list', async () => {
    expect((await POST(req({ jobId: 'x', decision: 'approve' }))).status).toBe(400)
    expect((await POST(req({ jobId: JOB, decision: 'maybe' }))).status).toBe(400)
    expect((await POST(req({ jobId: JOB, decision: 'keep', productIds: ['nope'] }))).status).toBe(400)
    expect(getImportJob).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown job and 400 for a non-sheet job', async () => {
    vi.mocked(getImportJob).mockResolvedValueOnce(null as any)
    expect((await POST(req({ jobId: JOB, decision: 'keep' }))).status).toBe(404)
    vi.mocked(getImportJob).mockResolvedValueOnce(job({ source: 'upload' }) as any)
    expect((await POST(req({ jobId: JOB, decision: 'keep' }))).status).toBe(400)
  })

  it('returns 409 when the sync is unfinished, superseded, active, or has nothing pending', async () => {
    const call = () => POST(req({ jobId: JOB, decision: 'keep' }))
    vi.mocked(getImportJob).mockResolvedValueOnce(job({ status: 'running' }) as any)
    expect((await call()).status).toBe(409)
    vi.mocked(latestJobBySource).mockResolvedValueOnce({ id: 'newer' } as any)
    expect((await call()).status).toBe(409)
    vi.mocked(hasActiveSheetSync).mockResolvedValueOnce(true as any)
    expect((await call()).status).toBe(409)
    vi.mocked(getImportJob).mockResolvedValueOnce(job({ pending_deletions: [] }) as any)
    expect((await call()).status).toBe(409)
    expect(updateImportJob).not.toHaveBeenCalled()
  })

  it('returns 409 when the selected products match nothing pending', async () => {
    const res = await POST(req({ jobId: JOB, decision: 'keep', productIds: ['88888888-8888-4888-8888-888888888888'] }))
    expect(res.status).toBe(409)
    expect(removeSheetLinks).not.toHaveBeenCalled()
  })

  it('returns 404 when the store tenant cannot be resolved', async () => {
    vi.mocked(lookupTenantContextById).mockResolvedValue(null as any)
    expect((await POST(req({ jobId: JOB, decision: 'keep' }))).status).toBe(404)
  })

  it('approve: retires the orphans, records the rows and clears the pending list', async () => {
    const res = await POST(req({ jobId: JOB, decision: 'approve', productIds: [P1] }))
    expect(await res.json()).toEqual({ ok: true, decision: 'approve', applied: 1, remaining: 1 })
    expect(applyOrphanRemoval).toHaveBeenCalledWith('t1', 'sheet1', [{ productId: P1, sku: 'A', name: 'Alpha' }])
    expect(updateImportJob).toHaveBeenCalledWith(JOB, {
      row_results: [expect.objectContaining({ sku: 'A', outcome: 'deleted' })],
      pending_deletions: [{ productId: P2, sku: 'B', name: 'Beta' }],
    })
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'import', entityId: JOB }))
  })

  it('keep: unlinks the products and leaves them managed manually', async () => {
    const res = await POST(req({ jobId: JOB, decision: 'keep' }))
    expect(await res.json()).toEqual({ ok: true, decision: 'keep', applied: 2, remaining: 0 })
    expect(removeSheetLinks).toHaveBeenCalledWith('t1', 'sheet1', [P1, P2])
    expect(updateImportJob).toHaveBeenCalledWith(JOB, { pending_deletions: [] })
    expect(applyOrphanRemoval).not.toHaveBeenCalled()
  })

  it('runs without a tenant context on the platform store', async () => {
    vi.mocked(resolveImportTenantId).mockResolvedValue('platform')
    await POST(req({ jobId: JOB, decision: 'keep' }))
    expect(lookupTenantContextById).not.toHaveBeenCalled()
    expect(runWithTenantContext).not.toHaveBeenCalled()
    expect(removeSheetLinks).toHaveBeenCalled()
  })

  it('returns 409 when another sheet action holds the lock, 500 on other failures', async () => {
    vi.mocked(withImportLock).mockRejectedValueOnce(new ImportBusyError('busy'))
    expect((await POST(req({ jobId: JOB, decision: 'keep' }))).status).toBe(409)
    vi.mocked(applyOrphanRemoval).mockRejectedValueOnce(new Error('db'))
    expect((await POST(req({ jobId: JOB, decision: 'approve' }))).status).toBe(500)
  })
})
