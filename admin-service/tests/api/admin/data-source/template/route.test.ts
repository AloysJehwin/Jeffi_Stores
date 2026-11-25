import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/import/template', () => ({ buildTemplateWorkbook: vi.fn(), buildTemplateCsv: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/data-source/template/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { buildTemplateWorkbook, buildTemplateCsv } from '@/lib/import/template'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/data-source/template${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(buildTemplateWorkbook).mockResolvedValue(Buffer.from('XLSX') as any)
  vi.mocked(buildTemplateCsv).mockReturnValue('a,b\n' as any)
})

describe('GET /api/admin/data-source/template', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:read')
    expect(logAdminAudit).not.toHaveBeenCalled()
  })

  it('streams the xlsx template and audits the export', async () => {
    const res = await GET(req())
    expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toContain('product-import-template.xlsx')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('XLSX')
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', action: 'export', summary: expect.stringContaining('xlsx') }))
  })

  it('streams the csv template for format=csv', async () => {
    const res = await GET(req('?format=csv'))
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(await res.text()).toBe('a,b\n')
    expect(buildTemplateWorkbook).not.toHaveBeenCalled()
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.stringContaining('csv') }))
  })

  it('propagates a workbook build failure', async () => {
    vi.mocked(buildTemplateWorkbook).mockRejectedValue(new Error('xlsx'))
    await expect(GET(req())).rejects.toThrow('xlsx')
  })
})
