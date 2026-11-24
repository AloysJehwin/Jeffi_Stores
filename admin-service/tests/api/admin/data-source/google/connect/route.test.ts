import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ platformOAuthBaseUrl: vi.fn(), currentAdminBaseUrlAsync: vi.fn() }))
vi.mock('@/lib/shared/oauth-state', () => ({ signAdminState: vi.fn() }))
vi.mock('@/lib/import/google-sync', () => ({ extractSpreadsheetId: vi.fn() }))
vi.mock('@/lib/import/jobs', () => ({ resolveImportTenantId: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/data-source/google/connect/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { platformOAuthBaseUrl, currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { extractSpreadsheetId } from '@/lib/import/google-sync'
import { resolveImportTenantId } from '@/lib/import/jobs'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/data-source/google/connect${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const oldId = process.env.GOOGLE_OAUTH_CLIENT_ID

beforeEach(() => {
  vi.resetAllMocks()
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com'
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue('t1')
  vi.mocked(platformOAuthBaseUrl).mockReturnValue('https://oauth.test')
  vi.mocked(currentAdminBaseUrlAsync).mockResolvedValue('https://admin.test')
  vi.mocked(signAdminState).mockReturnValue('signed')
  vi.mocked(extractSpreadsheetId).mockReturnValue(null as any)
})
afterEach(() => {
  if (oldId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID
  else process.env.GOOGLE_OAUTH_CLIENT_ID = oldId
})

describe('GET /api/admin/data-source/google/connect', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:write')
  })

  it('returns 503 when Google OAuth is not configured', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    expect((await GET(req())).status).toBe(503)
    expect(signAdminState).not.toHaveBeenCalled()
  })

  it('redirects to Google consent with the signed state and offline access', async () => {
    const res = await GET(req())
    const url = new URL(res.headers.get('location')!)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com')
    expect(url.searchParams.get('redirect_uri')).toBe('https://oauth.test/api/admin/data-source/google/callback')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('state')).toBe('signed')
    expect(url.searchParams.get('scope')).toContain('spreadsheets.readonly')
    expect(signAdminState).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', provider: 'google_sheets', returnBase: 'https://admin.test' }))
    expect(vi.mocked(signAdminState).mock.calls[0][0]).not.toHaveProperty('spreadsheetId')
  })

  it('carries a pasted spreadsheet id in the state', async () => {
    vi.mocked(extractSpreadsheetId).mockReturnValue('sheet123' as any)
    await GET(req('?sheet=https://docs.google.com/spreadsheets/d/sheet123'))
    expect(signAdminState).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: 'sheet123' }))
  })
})
