import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const jobs = vi.hoisted(() => ({
  claimNextImportJob: vi.fn(),
  failStaleImportJobs: vi.fn(),
  updateImportJob: vi.fn(),
  PLATFORM_TENANT_ID: 'platform',
}))
vi.mock('@/lib/import/jobs', () => jobs)
const reg = vi.hoisted(() => ({ lookupTenantContextById: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const als = vi.hoisted(() => ({ runWithTenantContext: vi.fn(async (_c: unknown, fn: () => unknown) => fn()) }))
vi.mock('@/lib/tenancy/tenant-context', () => als)
const s3 = vi.hoisted(() => ({ getImportFile: vi.fn() }))
vi.mock('@/lib/shared/s3', () => s3)
const imp = vi.hoisted(() => ({ runImport: vi.fn() }))
vi.mock('@controller/lib/catalog/product-import', () => imp)
const links = vi.hoisted(() => ({ upsertSheetLinks: vi.fn(), computeOrphans: vi.fn() }))
vi.mock('@/lib/import/sheet-links', () => links)

import { GET } from '@controller/app/api/(internal)/internal/import/worker/route'

const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/internal/import/worker', { headers: auth ? { authorization: auth } : {} }))
const outcome = { totalRows: 4, createdCount: 3, updatedCount: 1, errorCount: 0, rowResults: [], imageProgress: {}, seenProducts: [{ sku: 'A' }] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  jobs.failStaleImportJobs.mockResolvedValue(0)
  jobs.claimNextImportJob.mockResolvedValue({ id: 'j-1', tenant_id: 't-1', file_key: 'f.xlsx', source: 'upload' })
  jobs.updateImportJob.mockResolvedValue(undefined)
  reg.lookupTenantContextById.mockResolvedValue({ tenantId: 't-1' })
  s3.getImportFile.mockResolvedValue(Buffer.from('x'))
  imp.runImport.mockResolvedValue(outcome)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/internal/import/worker', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer x')).status).toBe(401)
    expect(jobs.claimNextImportJob).not.toHaveBeenCalled()
  })

  it('reports nothing claimed when the queue is empty', async () => {
    jobs.failStaleImportJobs.mockResolvedValue(2)
    jobs.claimNextImportJob.mockResolvedValue(null)
    expect(await (await call()).json()).toEqual({ success: true, claimed: false, reset: 2 })
  })

  it('fails a job whose tenant cannot be resolved', async () => {
    reg.lookupTenantContextById.mockResolvedValue(null)
    const body = await (await call()).json()
    expect(body).toEqual({ success: false, jobId: 'j-1', error: 'tenant not resolvable' })
    expect(jobs.updateImportJob).toHaveBeenCalledWith('j-1', expect.objectContaining({ status: 'failed', finished: true }))
    expect(imp.runImport).not.toHaveBeenCalled()
  })

  it('fails a job with no staged file', async () => {
    jobs.claimNextImportJob.mockResolvedValue({ id: 'j-1', tenant_id: 't-1', file_key: null })
    expect((await (await call()).json()).error).toBe('no file')
    expect(jobs.updateImportJob).toHaveBeenCalledWith('j-1', expect.objectContaining({ last_error: 'no file_key on job' }))
  })

  it('imports a tenant job inside the tenant context and records the result', async () => {
    const res = await call()
    const body = await res.json()
    expect(body).toMatchObject({ success: true, jobId: 'j-1', createdCount: 3, pendingDeletions: [] })
    expect(als.runWithTenantContext).toHaveBeenCalledTimes(1)
    expect(s3.getImportFile).toHaveBeenCalledWith('f.xlsx')
    expect(jobs.updateImportJob).toHaveBeenLastCalledWith(
      'j-1',
      expect.objectContaining({ status: 'done', total_rows: 4, created_count: 3, finished: true, last_error: null })
    )
    expect(links.upsertSheetLinks).not.toHaveBeenCalled()
  })

  it('runs a platform job with no tenant context', async () => {
    jobs.claimNextImportJob.mockResolvedValue({ id: 'j-2', tenant_id: 'platform', file_key: 'f.xlsx', source: 'upload' })
    await call()
    expect(reg.lookupTenantContextById).not.toHaveBeenCalled()
    expect(als.runWithTenantContext).not.toHaveBeenCalled()
    expect(imp.runImport).toHaveBeenCalled()
  })

  it('tracks sheet links and orphans for a google sheet sync', async () => {
    jobs.claimNextImportJob.mockResolvedValue({ id: 'j-3', tenant_id: 't-1', file_key: 'f', source: 'google_sheet', spreadsheet_id: 'sp' })
    links.computeOrphans.mockResolvedValue([{ sku: 'OLD' }])
    const body = await (await call()).json()
    expect(links.upsertSheetLinks).toHaveBeenCalledWith('t-1', 'sp', 'j-3', outcome.seenProducts)
    expect(links.computeOrphans).toHaveBeenCalledWith('t-1', 'sp', ['A'])
    expect(body.pendingDeletions).toEqual([{ sku: 'OLD' }])
  })

  it('keeps the import result when link tracking fails', async () => {
    jobs.claimNextImportJob.mockResolvedValue({ id: 'j-3', tenant_id: 't-1', file_key: 'f', source: 'google_sheet', spreadsheet_id: 'sp' })
    links.upsertSheetLinks.mockRejectedValue(new Error('x'))
    const body = await (await call()).json()
    expect(body.success).toBe(true)
    expect(jobs.updateImportJob).toHaveBeenLastCalledWith('j-3', expect.objectContaining({ status: 'done', last_error: expect.stringContaining('tracking failed') }))
  })

  it.each([
    [Object.assign(new Error('x'), { name: 'NoSuchKey' }), 'no longer available'],
    [Object.assign(new Error('x'), { code: '23505' }), 'database error'],
    [new Error('AccessDenied for bucket'), 'Could not read the uploaded file'],
    [new Error('Row 3 has no SKU'), 'Row 3 has no SKU'],
  ])('records a friendly failure message (%#)', async (err, expected) => {
    s3.getImportFile.mockRejectedValue(err)
    const body = await (await call()).json()
    expect(body.success).toBe(false)
    expect(body.error).toContain(expected)
    expect(jobs.updateImportJob).toHaveBeenLastCalledWith('j-1', expect.objectContaining({ status: 'failed', finished: true }))
  })
})
