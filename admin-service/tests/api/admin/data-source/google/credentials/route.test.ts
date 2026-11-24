import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ getIntegrationCredential: vi.fn(), saveIntegrationCredential: vi.fn() }))
vi.mock('@/lib/crypto/token-cipher', () => ({ encryptToken: vi.fn(), decryptToken: vi.fn() }))
vi.mock('@/lib/shared/google-credentials', () => ({ parseServiceAccountJson: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({
  googleOAuthAccessToken: vi.fn(),
  googleServiceAccountAccessToken: vi.fn(),
  GOOGLE_SHEETS_SCOPES: ['scope'],
}))
vi.mock('@/lib/import/jobs', () => {
  class ImportBusyError extends Error {}
  return { resolveImportTenantId: vi.fn(), withImportLock: vi.fn(), ImportBusyError }
})
vi.mock('@/lib/import/google-sync', () => ({ extractSpreadsheetId: vi.fn(), describeGoogleFailure: vi.fn() }))
vi.mock('@/lib/shared/google-sheets', () => ({ listSheetTitles: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/data-source/google/credentials/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { parseServiceAccountJson } from '@/lib/shared/google-credentials'
import { googleOAuthAccessToken, googleServiceAccountAccessToken } from '@/lib/integrations/resolve'
import { resolveImportTenantId, withImportLock, ImportBusyError } from '@/lib/import/jobs'
import { extractSpreadsheetId, describeGoogleFailure } from '@/lib/import/google-sync'
import { listSheetTitles } from '@/lib/shared/google-sheets'

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/data-source/google/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const oauth = { mode: 'oauth', clientId: 'abc.apps.googleusercontent.com', clientSecret: 'secretsecret1', refreshToken: 'r'.repeat(24) }
const sa = { mode: 'service_account', serviceAccountJson: '{"type":"service_account","k":"v"}' }
const saKey = { client_email: 'bot@proj.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue('t1')
  vi.mocked(extractSpreadsheetId).mockReturnValue(null as any)
  vi.mocked(googleOAuthAccessToken).mockResolvedValue({ token: 'at' } as any)
  vi.mocked(googleServiceAccountAccessToken).mockResolvedValue({ token: 'sat' } as any)
  vi.mocked(parseServiceAccountJson).mockReturnValue(saKey as any)
  vi.mocked(getIntegrationCredential).mockResolvedValue(null as any)
  vi.mocked(encryptToken).mockImplementation(((s: string) => `enc:${s}`) as any)
  vi.mocked(withImportLock).mockImplementation((async (_t: any, _k: any, fn: any) => fn()) as any)
  vi.mocked(saveIntegrationCredential).mockResolvedValue(undefined as any)
})

describe('POST /api/admin/data-source/google/credentials', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req(oauth))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req(oauth))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:write')
  })

  it('returns 400 for a malformed body, a bad client id, and an unreadable sheet link', async () => {
    expect((await POST(req({ mode: 'nope' }))).status).toBe(400)
    expect((await POST(req({ ...oauth, clientId: 'abc' }))).status).toBe(400)
    const res = await POST(req({ ...oauth, sheet: 'garbage' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Google Sheets link')
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid or non-service-account key', async () => {
    vi.mocked(parseServiceAccountJson).mockImplementationOnce(() => {
      throw new Error('bad json')
    })
    expect((await POST(req(sa))).status).toBe(400)
    vi.mocked(parseServiceAccountJson).mockReturnValueOnce({ client_email: 'a@gmail.com', private_key: 'x' } as any)
    expect((await POST(req(sa))).status).toBe(400)
  })

  it('returns 400 when Google refuses the credentials', async () => {
    vi.mocked(googleOAuthAccessToken).mockRejectedValue(new Error('invalid_client'))
    const res = await POST(req(oauth))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('invalid_client')
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('saves own-OAuth credentials flagged as needing a sheet id when none is known', async () => {
    expect(await (await POST(req(oauth))).json()).toEqual({ ok: true })
    const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0] as any
    expect(saved).toMatchObject({ tenantId: 't1', provider: 'google_sheets', meta: { connected_via: 'own_oauth', can_create: true, needs_spreadsheet_id: true } })
    expect(JSON.parse(saved.configEnc.replace('enc:', ''))).toMatchObject({ client_id: oauth.clientId, oauth_refresh_token: oauth.refreshToken })
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', action: 'update' }))
  })

  it('verifies access to a given sheet and stores its id', async () => {
    vi.mocked(extractSpreadsheetId).mockReturnValue('sheet9' as any)
    vi.mocked(listSheetTitles).mockResolvedValue(['Products'] as any)
    await POST(req({ ...oauth, sheet: 'https://docs.google.com/spreadsheets/d/sheet9' }))
    expect(listSheetTitles).toHaveBeenCalledWith('sheet9', 'at')
    expect((vi.mocked(saveIntegrationCredential).mock.calls[0][0] as any).meta).toMatchObject({ spreadsheet_id: 'sheet9' })
  })

  it('reuses a stored sheet id', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue({ config_enc: 'blob' } as any)
    vi.mocked(decryptToken).mockReturnValue(JSON.stringify({ spreadsheet_id: 'old1' }))
    vi.mocked(listSheetTitles).mockResolvedValue([] as any)
    await POST(req(oauth))
    expect(listSheetTitles).toHaveBeenCalledWith('old1', 'at')
  })

  it('asks a service account to be shared on the sheet when access is missing', async () => {
    vi.mocked(extractSpreadsheetId).mockReturnValue('sheet9' as any)
    vi.mocked(listSheetTitles).mockRejectedValue(new Error('403'))
    vi.mocked(describeGoogleFailure).mockReturnValue({ status: 403, error: 'no access', code: 'no_access' } as any)
    const res = await POST(req({ ...sa, sheet: 'sheet9' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain(saKey.client_email)
    expect(body.code).toBe('no_access')
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('saves a service account with can_create false', async () => {
    expect((await POST(req(sa))).status).toBe(200)
    expect((vi.mocked(saveIntegrationCredential).mock.calls[0][0] as any).meta).toMatchObject({ connected_via: 'service_account', can_create: false })
  })

  it('returns 409 when another sheet action holds the lock', async () => {
    vi.mocked(withImportLock).mockRejectedValue(new ImportBusyError('busy'))
    expect((await POST(req(oauth))).status).toBe(409)
  })

  it('propagates other save failures', async () => {
    vi.mocked(withImportLock).mockRejectedValue(new Error('db'))
    await expect(POST(req(oauth))).rejects.toThrow('db')
  })
})
