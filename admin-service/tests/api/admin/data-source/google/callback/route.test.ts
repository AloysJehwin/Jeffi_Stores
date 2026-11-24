import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/catalog/brand', () => ({ currentAdminBaseUrl: vi.fn(), platformOAuthBaseUrl: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ saveIntegrationCredential: vi.fn(), getIntegrationCredential: vi.fn(), getTenant: vi.fn() }))
vi.mock('@/lib/crypto/token-cipher', () => ({ encryptToken: vi.fn(), decryptToken: vi.fn() }))
vi.mock('@/lib/shared/oauth-state', () => ({ verifyAdminState: vi.fn(), returnToAdmin: vi.fn(), safeReturnBase: vi.fn() }))
vi.mock('@/lib/integrations/oauth', () => ({ tenantAdminUrl: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/data-source/google/callback/route'
import { currentAdminBaseUrl, platformOAuthBaseUrl } from '@/lib/catalog/brand'
import { saveIntegrationCredential, getIntegrationCredential, getTenant } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { verifyAdminState, returnToAdmin, safeReturnBase } from '@/lib/shared/oauth-state'
import { tenantAdminUrl } from '@/lib/integrations/oauth'

const BACK = 'https://admin.test/admin/data-source?tab=google_sheet'
const req = (qs: string) => new NextRequest(`http://localhost/api/admin/data-source/google/callback${qs}`)
const location = (res: Response) => res.headers.get('location')
const state = { tenantId: 't1', provider: 'google_sheets', spreadsheetId: 'sheet1' }
const realFetch = globalThis.fetch
const oldEnv = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret'
  globalThis.fetch = fetchMock as any
  vi.mocked(currentAdminBaseUrl).mockReturnValue('https://admin.test')
  vi.mocked(platformOAuthBaseUrl).mockReturnValue('https://oauth.test')
  vi.mocked(returnToAdmin).mockImplementation(((u: string) => NextResponse.redirect(u)) as any)
  vi.mocked(verifyAdminState).mockReturnValue(state as any)
  vi.mocked(getTenant).mockResolvedValue(null as any)
  vi.mocked(encryptToken).mockImplementation(((s: string) => `enc:${s}`) as any)
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('oauth2.googleapis.com')
      ? json({ refresh_token: 'rt', access_token: 'at', scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file' })
      : json({ user: { emailAddress: 'me@x.test' } })
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  for (const [k, v] of [['GOOGLE_OAUTH_CLIENT_ID', oldEnv.id], ['GOOGLE_OAUTH_CLIENT_SECRET', oldEnv.secret]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('GET /api/admin/data-source/google/callback', () => {
  it('redirects with the provider error', async () => {
    expect(location(await GET(req('?error=access_denied')))).toBe(`${BACK}&connected=0&error=access_denied`)
  })

  it('fails on missing params and on a bad state', async () => {
    expect(location(await GET(req('?code=c')))).toBe(`${BACK}&connected=0&error=missing_params`)
    vi.mocked(verifyAdminState).mockReturnValue({ ...state, provider: 'other' } as any)
    expect(location(await GET(req('?code=c&state=s')))).toBe(`${BACK}&connected=0&error=bad_state`)
  })

  it('fails when the Google client is not configured', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    expect(location(await GET(req('?code=c&state=s')))).toBe(`${BACK}&connected=0&error=not_configured`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when the token exchange returns no refresh token', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400))
    expect(location(await GET(req('?code=c&state=s')))).toBe(`${BACK}&connected=0&error=exchange_failed`)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('fails when the sheets permission was unticked', async () => {
    fetchMock.mockResolvedValueOnce(json({ refresh_token: 'rt', access_token: 'at', scope: 'https://www.googleapis.com/auth/drive.file' }))
    expect(location(await GET(req('?code=c&state=s')))).toBe(`${BACK}&connected=0&error=sheets_scope_denied`)
  })

  it('stores the refresh token and sheet id and redirects connected', async () => {
    const res = await GET(req('?code=c&state=s'))
    expect(location(res)).toBe(`${BACK}&connected=google_sheets`)
    const [tokenUrl, init] = fetchMock.mock.calls[0]
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(String(init.body)).toContain('redirect_uri=https%3A%2F%2Foauth.test%2Fapi%2Fadmin%2Fdata-source%2Fgoogle%2Fcallback')
    const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0] as any
    expect(saved).toMatchObject({ tenantId: 't1', provider: 'google_sheets', meta: { connected_via: 'oauth', can_create: true, account_email: 'me@x.test', spreadsheet_id: 'sheet1' } })
    expect(JSON.parse(saved.configEnc.slice(4))).toEqual({ oauth_refresh_token: 'rt', spreadsheet_id: 'sheet1' })
  })

  it('keeps a previously stored sheet id, and flags a missing one', async () => {
    vi.mocked(verifyAdminState).mockReturnValue({ tenantId: 't1', provider: 'google_sheets' } as any)
    vi.mocked(getIntegrationCredential).mockResolvedValueOnce({ config_enc: 'blob' } as any)
    vi.mocked(decryptToken).mockReturnValueOnce(JSON.stringify({ spreadsheet_id: 'old1' }))
    await GET(req('?code=c&state=s'))
    expect((vi.mocked(saveIntegrationCredential).mock.calls[0][0] as any).meta.spreadsheet_id).toBe('old1')
    await GET(req('?code=c&state=s'))
    expect((vi.mocked(saveIntegrationCredential).mock.calls[1][0] as any).meta.needs_spreadsheet_id).toBe(true)
  })

  it('lands on the tenant admin when the state return base is trusted', async () => {
    vi.mocked(getTenant).mockResolvedValue({ slug: 'shop' } as any)
    vi.mocked(tenantAdminUrl).mockReturnValue('https://shop.admin.test')
    vi.mocked(safeReturnBase).mockReturnValue('https://shop.admin.test' as any)
    expect(location(await GET(req('?code=c&state=s')))).toBe('https://shop.admin.test/admin/data-source?tab=google_sheet&connected=google_sheets')
  })

  it('redirects with save_failed when storing the credential throws', async () => {
    vi.mocked(saveIntegrationCredential).mockRejectedValue(new Error('db'))
    expect(location(await GET(req('?code=c&state=s')))).toBe(`${BACK}&connected=0&error=save_failed`)
  })
})
