import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/import/jobs', () => {
  class ImportBusyError extends Error {}
  return {
    resolveImportTenantId: vi.fn(),
    withImportLock: vi.fn(),
    setSheetsNeedsReconnect: vi.fn(),
    setSheetsSpreadsheet: vi.fn(),
    ImportBusyError,
  }
})
vi.mock('@/lib/integrations/resolve', () => {
  class IntegrationNotConnectedError extends Error {
    constructor(
      public provider: string,
      tenantId: string
    ) {
      super(`${provider} not connected for ${tenantId}`)
    }
  }
  return { resolveGoogleSheetsCreds: vi.fn(), IntegrationNotConnectedError }
})
vi.mock('@/lib/shared/google-sheets', () => ({ createSheetFromWorkbook: vi.fn() }))
vi.mock('@/lib/import/template', () => ({ buildTemplateWorkbook: vi.fn() }))
vi.mock('@/lib/import/google-sync', () => ({ describeGoogleFailure: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/data-source/google/create/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { resolveImportTenantId, withImportLock, setSheetsNeedsReconnect, setSheetsSpreadsheet, ImportBusyError } from '@/lib/import/jobs'
import { resolveGoogleSheetsCreds, IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { createSheetFromWorkbook } from '@/lib/shared/google-sheets'
import { buildTemplateWorkbook } from '@/lib/import/template'
import { describeGoogleFailure } from '@/lib/import/google-sync'

const req = () => new NextRequest('http://localhost/api/admin/data-source/google/create', { method: 'POST' })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue('t1')
  vi.mocked(withImportLock).mockImplementation((async (_t: any, _k: any, fn: any) => fn()) as any)
  vi.mocked(resolveGoogleSheetsCreds).mockResolvedValue({ accessToken: 'tok' } as any)
  vi.mocked(buildTemplateWorkbook).mockResolvedValue(Buffer.from('x') as any)
  vi.mocked(createSheetFromWorkbook).mockResolvedValue('sheet1' as any)
  vi.mocked(setSheetsNeedsReconnect).mockResolvedValue(undefined as any)
})

describe('POST /api/admin/data-source/google/create', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:write')
    expect(createSheetFromWorkbook).not.toHaveBeenCalled()
  })

  it('creates the sheet, saves its id and audits', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ spreadsheetId: 'sheet1', url: 'https://docs.google.com/spreadsheets/d/sheet1' })
    expect(createSheetFromWorkbook).toHaveBeenCalledWith('Product import', expect.anything(), 'tok')
    expect(setSheetsSpreadsheet).toHaveBeenCalledWith('t1', 'sheet1')
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', metadata: { spreadsheetId: 'sheet1' } }))
  })

  it('returns 409 when no Google account is connected', async () => {
    vi.mocked(resolveGoogleSheetsCreds).mockRejectedValue(new IntegrationNotConnectedError('google_sheets', 't1'))
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_connected')
    expect(createSheetFromWorkbook).not.toHaveBeenCalled()
  })

  it('flags reconnect when the token needs re-authorising', async () => {
    vi.mocked(resolveGoogleSheetsCreds).mockRejectedValue(new Error('invalid_grant'))
    vi.mocked(describeGoogleFailure).mockReturnValue({ status: 401, error: 'Reconnect', code: 'reauth' } as any)
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(setSheetsNeedsReconnect).toHaveBeenCalledWith('t1', true)
  })

  it('maps a Drive permission failure to a scope message', async () => {
    vi.mocked(createSheetFromWorkbook).mockRejectedValue(new Error('403'))
    vi.mocked(describeGoogleFailure).mockReturnValue({ status: 403, error: 'denied', code: 'no_access' } as any)
    const res = await POST(req())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('scope')
    expect(body.error).toContain('Reconnect')
    expect(setSheetsSpreadsheet).not.toHaveBeenCalled()
    expect(logAdminAudit).not.toHaveBeenCalled()
  })

  it('passes other Drive failures through with their status', async () => {
    vi.mocked(createSheetFromWorkbook).mockRejectedValue(new Error('boom'))
    vi.mocked(describeGoogleFailure).mockReturnValue({ status: 503, error: 'Google is down', code: 'unavailable' } as any)
    const res = await POST(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Google is down', code: 'unavailable' })
  })

  it('returns 409 when another sheet action holds the lock', async () => {
    vi.mocked(withImportLock).mockRejectedValue(new ImportBusyError('busy'))
    expect((await POST(req())).status).toBe(409)
  })

  it('returns 500 on an unexpected failure', async () => {
    vi.mocked(withImportLock).mockRejectedValue(new Error('db'))
    expect((await POST(req())).status).toBe(500)
  })
})
