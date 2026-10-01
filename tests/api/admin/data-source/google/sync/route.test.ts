import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ uploadImportFile: vi.fn().mockResolvedValue('imports/x.xlsx') }))
vi.mock('@/lib/import/jobs', () => ({
  enqueueImportJob: vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued' }),
  resolveImportTenantId: vi.fn().mockResolvedValue('tenant-1'),
}))
vi.mock('@/lib/integrations/resolve', () => ({
  resolveGoogleSheetsCreds: vi.fn().mockResolvedValue({ accessToken: 'tok', spreadsheetId: 'sheet-1' }),
  IntegrationNotConnectedError: class extends Error {},
}))
vi.mock('@/lib/shared/google-sheets', async () => {
  const actual = await vi.importActual<typeof import('@/lib/shared/google-sheets')>('@/lib/shared/google-sheets')
  return { ...actual, listSheetTitles: vi.fn(), readSheetValues: vi.fn(), readSheetValuesBatch: vi.fn() }
})

import { POST } from '@/app/api/(admin)/admin/data-source/google/sync/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { listSheetTitles, readSheetValues, readSheetValuesBatch } from '@/lib/shared/google-sheets'
import { enqueueImportJob } from '@/lib/import/jobs'

const mockAuth = vi.mocked(requireAdminScope)
const mockTitles = vi.mocked(listSheetTitles)
const mockRead = vi.mocked(readSheetValues)
const mockBatch = vi.mocked(readSheetValuesBatch)
const req = () => new NextRequest('http://localhost/api/admin/data-source/google/sync', { method: 'POST', body: '{}' })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: ['products:write'] } as any)
})

describe('POST /api/admin/data-source/google/sync', () => {
  it('reads every template tab present when the sheet was created from the template', async () => {
    mockTitles.mockResolvedValue(['Field Guide', 'Products', 'Product · Shipping', 'Variants', 'Sub-variants', 'Notes'])
    mockBatch.mockResolvedValue([
      [
        ['sku', 'name', 'category', 'brand', 'base_price'],
        ['A1', 'Thing', 'Cat', 'Brand', '10'],
      ],
      [
        ['sku', 'weight_grams'],
        ['A1', '250'],
      ],
      [
        ['parent_sku', 'variant.sku', 'variant.variant_name', 'variant.price'],
        ['A1', 'A1-S', 'Small', '10'],
      ],
      [['parent_sku', 'variant_sku', 'sub_variant.sku', 'sub_variant.sub_variant_name']],
    ])
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ jobId: 'job-1', totalRows: 2 })
    const ranges = mockBatch.mock.calls[0][1]
    expect(ranges).toEqual(["'Products'!A:ZZ", "'Product · Shipping'!A:ZZ", "'Variants'!A:ZZ", "'Sub-variants'!A:ZZ"])
    expect(mockRead).not.toHaveBeenCalled()
    expect(vi.mocked(enqueueImportJob).mock.calls[0][0]).toMatchObject({
      source: 'google_sheet',
      spreadsheetId: 'sheet-1',
      totalRows: 2,
    })
  })

  it('falls back to the first tab as a flat grid when there is no Products tab', async () => {
    mockTitles.mockResolvedValue(['Sheet1'])
    mockRead.mockResolvedValue([
      ['row_type', 'sku', 'name', 'category', 'brand', 'base_price'],
      ['product', 'X1', 'Thing', 'Cat', 'Brand', '10'],
    ])
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(mockBatch).not.toHaveBeenCalled()
    expect(mockRead).toHaveBeenCalledWith('sheet-1', 'A:DZ', 'tok')
  })

  it('400s with the parser message when the template has nothing filled in', async () => {
    mockTitles.mockResolvedValue(['Products', 'Variants'])
    mockBatch.mockResolvedValue([[['sku', 'name']], [['parent_sku', 'variant.sku']]])
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No data rows/)
  })

  it('502s when Google refuses the read', async () => {
    mockTitles.mockRejectedValue(new Error('The caller does not have permission'))
    const res = await POST(req())
    expect(res.status).toBe(502)
  })
})
