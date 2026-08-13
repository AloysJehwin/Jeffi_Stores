import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'

const mockQuery = vi.hoisted(() => vi.fn())
const mockIssueMfaTicket = vi.hoisted(() => vi.fn())
const mockResolveAdminByEmail = vi.hoisted(() => vi.fn())
const mockEnforceCertGate = vi.hoisted(() => vi.fn())
const mockLogActivity = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ query: mockQuery }))
vi.mock('@/lib/mfa', () => ({ issueMfaTicket: mockIssueMfaTicket }))
vi.mock('@/lib/admin-identity', () => ({
  resolveAdminByEmail: mockResolveAdminByEmail,
  enforceCertGate: mockEnforceCertGate,
}))
vi.mock('@/lib/activity', () => ({ logActivity: mockLogActivity }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from '@/app/api/admin/auth/google/route'

function makePost(body: object, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const ADMIN = {
  id: 'admin-1', user_id: 'user-1', google_id: 'google-sub-123',
  mfa_enabled: true,
}

describe('POST /api/admin/auth/google', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockQuery.mockResolvedValue({ rows: [] })
    mockIssueMfaTicket.mockResolvedValue('ticket-abc')
    mockLogActivity.mockResolvedValue(undefined)
    mockEnforceCertGate.mockResolvedValue({ ok: true, certCN: 'cn' })
  })

  it('400 when neither token provided', async () => {
    const res = await POST(makePost({}) as any)
    expect(res.status).toBe(400)
  })

  it('400 when request body is invalid JSON', async () => {
    const bad = new Request('http://localhost/api/admin/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    })
    const res = await POST(bad as any)
    expect(res.status).toBe(400)
  })

  it('401 when idToken tokeninfo not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const res = await POST(makePost({ idToken: 'bad' }) as any)
    expect(res.status).toBe(401)
  })

  it('401 when idToken payload missing sub/email', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'a@b.com' }) })
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(401)
  })

  it('401 when idToken aud mismatch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 's', email: 'a@b.com', aud: 'wrong-id', email_verified: 'true' }),
    })
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(401)
  })

  it('401 when idToken email_verified string is "false"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 's', email: 'a@b.com', aud: 'test-google-client-id', email_verified: 'false' }),
    })
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(401)
  })

  it('401 when idToken fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(401)
  })

  it('403 when admin not resolved', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'google-sub-123', email: 'a@b.com', aud: ['test-google-client-id'], email_verified: 'true' }),
    })
    mockResolveAdminByEmail.mockResolvedValueOnce(null)
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(403)
  })

  it('403 when admin google_id mismatch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'other-sub', email: 'a@b.com', aud: ['test-google-client-id'], email_verified: 'true' }),
    })
    mockResolveAdminByEmail.mockResolvedValueOnce(ADMIN)
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(403)
  })

  it('cert gate failure returns gate status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'google-sub-123', email: 'a@b.com', aud: ['test-google-client-id'], email_verified: 'true' }),
    })
    mockResolveAdminByEmail.mockResolvedValueOnce(ADMIN)
    mockEnforceCertGate.mockResolvedValueOnce({ ok: false, error: 'cert required', status: 428 })
    const res = await POST(makePost({ idToken: 't' }, { 'x-client-cert-cn': 'CN', 'x-client-cert-serial': 'S' }) as any)
    expect(res.status).toBe(428)
    expect((await res.json()).error).toBe('cert required')
  })

  it('verify path (mfa enabled) returns mfa_required', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'google-sub-123', email: 'a@b.com', aud: ['test-google-client-id'], email_verified: 'true' }),
    })
    mockResolveAdminByEmail.mockResolvedValueOnce(ADMIN)
    const res = await POST(makePost({ idToken: 't' }) as any)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.mfa_required).toBe(true)
    expect(data.ticket).toBe('ticket-abc')
  })

  it('enroll path (mfa disabled) returns enroll_required and backfills google_id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'google-sub-123', email: 'a@b.com', aud: ['test-google-client-id'], email_verified: 'true' }),
    })
    // admin with no google_id triggers backfill query
    mockResolveAdminByEmail.mockResolvedValueOnce({ ...ADMIN, google_id: null, mfa_enabled: false })
    const res = await POST(makePost({ idToken: 't' }) as any)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.enroll_required).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE users SET google_id/),
      ['google-sub-123', 'user-1']
    )
  })

  it('accessToken path: 401 when userinfo not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const res = await POST(makePost({ accessToken: 'at' }) as any)
    expect(res.status).toBe(401)
  })

  it('accessToken path: 401 when email_verified false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 's', email: 'a@b.com', email_verified: false }),
    })
    const res = await POST(makePost({ accessToken: 'at' }) as any)
    expect(res.status).toBe(401)
  })

  it('accessToken path: 401 when missing sub', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'a@b.com' }) })
    const res = await POST(makePost({ accessToken: 'at' }) as any)
    expect(res.status).toBe(401)
  })

  it('accessToken path: 401 when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(makePost({ accessToken: 'at' }) as any)
    expect(res.status).toBe(401)
  })

  it('accessToken path: success verify', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'google-sub-123', email: 'a@b.com', email_verified: true }),
    })
    mockResolveAdminByEmail.mockResolvedValueOnce(ADMIN)
    const res = await POST(makePost({ accessToken: 'at' }) as any)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.mfa_required).toBe(true)
  })

  it('backfill google_id catch callback runs when query rejects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'google-sub-123', email: 'a@b.com', aud: ['test-google-client-id'], email_verified: 'true' }),
    })
    mockResolveAdminByEmail.mockResolvedValueOnce({ ...ADMIN, google_id: null })
    mockQuery.mockRejectedValueOnce(new Error('update fail')) // backfill rejects -> .catch(()=>{})
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(200)
  })

  it('logActivity catch callback runs when logActivity rejects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'google-sub-123', email: 'a@b.com', aud: ['test-google-client-id'], email_verified: 'true' }),
    })
    mockResolveAdminByEmail.mockResolvedValueOnce(ADMIN)
    mockLogActivity.mockRejectedValueOnce(new Error('log fail')) // -> .catch(()=>{})
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(200)
  })

  it('500 on unexpected error inside handler', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'google-sub-123', email: 'a@b.com', aud: ['test-google-client-id'], email_verified: 'true' }),
    })
    mockResolveAdminByEmail.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(makePost({ idToken: 't' }) as any)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Internal server error/)
  })
})
