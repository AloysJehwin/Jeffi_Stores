import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as XLSX from 'xlsx'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ uploadImportFile: vi.fn().mockResolvedValue('imports/x.xlsx') }))
vi.mock('@/lib/import/jobs', () => {
  class ImportBusyError extends Error {}
  return {
    ImportBusyError,
    enqueueImportJob: vi.fn().mockResolvedValue({ id: 'job-1', status: 'pending' }),
    resolveImportTenantId: vi.fn().mockResolvedValue('tenant-1'),
    withImportLock: vi.fn((_t: string, _k: string, fn: () => unknown) => fn()),
    findActiveUploadByFingerprint: vi.fn().mockResolvedValue(null),
  }
})

import { POST } from '@/app/api/(admin)/admin/data-source/import/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { enqueueImportJob, findActiveUploadByFingerprint, withImportLock, ImportBusyError } from '@/lib/import/jobs'
import { uploadImportFile } from '@/lib/shared/s3'

const xlsx = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Products')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function req(body: Buffer | string, name: string) {
  const fd = new FormData()
  fd.append('file', new File([typeof body === 'string' ? body : new Uint8Array(body)], name))
  return new NextRequest('http://localhost/api/admin/data-source/import', { method: 'POST', body: fd })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: ['products:write'] } as any)
})

describe('POST /api/admin/data-source/import', () => {
  it('queues a valid file and reports products and invalid rows', async () => {
    const res = await POST(req(xlsx([['sku', 'name', 'base_price'], ['A', 'Alpha', 10], ['', 'No sku', 1]]), 'p.xlsx'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ jobId: 'job-1', totalRows: 2, products: 2, invalid: 1 })
    expect(vi.mocked(uploadImportFile).mock.calls[0][1]).toMatch(/^[0-9a-f]{16}-p\.xlsx$/)
  })

  it('refuses a declared oversize body with 413 before reading it', async () => {
    // A real client sends Content-Length; the test Request recomputes it, so set it on the headers.
    const r = req('x', 'p.xlsx')
    r.headers.set('content-length', String(40 * 1024 * 1024))
    const res = await POST(r)
    expect(res.status).toBe(413)
    expect(enqueueImportJob).not.toHaveBeenCalled()
  })

  it('415s a wrong file type or bytes that do not match the extension', async () => {
    expect((await POST(req('hello', 'notes.pdf'))).status).toBe(415)
    expect((await POST(req('sku,name\nA,B\n', 'fake.xlsx'))).status).toBe(415)
  })

  it('400s an empty file and a file with no data rows', async () => {
    expect((await POST(req('', 'p.csv'))).status).toBe(400)
    const res = await POST(req(xlsx([['sku', 'name']]), 'p.xlsx'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No data rows/)
  })

  it('returns the running job for the same file instead of queuing it twice', async () => {
    vi.mocked(findActiveUploadByFingerprint).mockResolvedValueOnce({ id: 'job-0', status: 'running' } as any)
    const res = await POST(req(xlsx([['sku', 'name'], ['A', 'Alpha']]), 'p.xlsx'))
    expect(await res.json()).toMatchObject({ jobId: 'job-0', duplicate: true })
    expect(enqueueImportJob).not.toHaveBeenCalled()
  })

  it('409s while another upload holds the lock, and hides storage errors', async () => {
    vi.mocked(withImportLock).mockRejectedValueOnce(new (ImportBusyError as any)())
    expect((await POST(req(xlsx([['sku', 'name'], ['A', 'Alpha']]), 'p.xlsx'))).status).toBe(409)
    vi.mocked(uploadImportFile).mockRejectedValueOnce(new Error('NoSuchBucket: secret-bucket'))
    const res = await POST(req(xlsx([['sku', 'name'], ['A', 'Alpha']]), 'p.xlsx'))
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toMatch(/secret-bucket/)
  })
})
