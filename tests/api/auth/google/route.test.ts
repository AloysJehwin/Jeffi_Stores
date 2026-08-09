/**
 * Tests for POST /api/auth/google
 * src/app/api/auth/google/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must set env vars before module imports that read them at module init time
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockCookieStore = vi.hoisted(() => ({
  get: vi.fn().mockReturnValue(undefined),
  set: vi.fn(),
  delete: vi.fn(),
}))

const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }))
const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockUploadAvatarImage = vi.hoisted(() => vi.fn())
const mockIssueUserToken = vi.hoisted(() => vi.fn().mockResolvedValue({ sid: 'user-sid' }))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}))

vi.mock('@/lib/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

// Opaque sessions: the route issues a server-side session and sets cookie = sid.
// Mocking issueUserToken avoids exercising createSession's DB INSERT.
vi.mock('@/lib/issue-session', () => ({
  issueUserToken: mockIssueUserToken,
  USER_SESSION_TTL_S: 7 * 24 * 60 * 60,
}))

vi.mock('@/lib/activity', () => ({
  logActivity: mockLogActivity,
}))

vi.mock('@/lib/s3', () => ({
  uploadAvatarImage: mockUploadAvatarImage,
}))

vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

// ── mock global fetch ─────────────────────────────────────────────────────────
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from '@/app/api/auth/google/route'
import { cookies } from 'next/headers'

// ── helpers ───────────────────────────────────────────────────────────────────
function makePost(body: object) {
  return new Request('http://localhost/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const GOOGLE_PAYLOAD = {
  sub: 'google-sub-123',
  email: 'user@example.com',
  given_name: 'John',
  family_name: 'Doe',
  name: 'John Doe',
  picture: null,
  aud: 'test-google-client-id',
}

const DB_USER = {
  id: 'user-1',
  email: 'user@example.com',
  first_name: 'John',
  last_name: 'Doe',
  phone: '9876543210',
  google_id: 'google-sub-123',
  is_active: true,
  avatar_is_custom: false,
}

function mockIdTokenVerify(payload: object | null) {
  if (payload === null) {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
  } else {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload })
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/auth/google', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    vi.mocked(cookies).mockResolvedValue(mockCookieStore as any)
    mockCookieStore.get.mockReturnValue(undefined)
    mockQuery.mockResolvedValue({ rows: [] })
    mockLogActivity.mockResolvedValue(undefined)
    mockIssueUserToken.mockResolvedValue({ sid: 'user-sid' })
  })

  it('returns 400 when neither idToken nor accessToken is provided', async () => {
    const res = await POST(makePost({}) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/idToken or accessToken required/i)
  })

  it('returns 401 when idToken is invalid (google returns non-ok)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const res = await POST(makePost({ idToken: 'bad-token' }) as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/invalid google token/i)
  })

  it('returns 401 when google payload has no sub', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'x@x.com' }) })
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 when GOOGLE_CLIENT_ID mismatch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...GOOGLE_PAYLOAD, aud: 'wrong-client-id' }),
    })
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(401)
  })

  it('creates new user when not found, returns login response', async () => {
    mockIdTokenVerify(GOOGLE_PAYLOAD)
    mockQueryOne
      .mockResolvedValueOnce(null)     // user lookup → not found
      .mockResolvedValueOnce(DB_USER)  // INSERT → new user
      .mockResolvedValueOnce(null)     // guest user lookup
    const res = await POST(makePost({ idToken: 'valid-token' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/login successful/i)
    expect(body.user.email).toBe('user@example.com')
    expect(mockCookieStore.set).toHaveBeenCalledWith('user_sid', 'user-sid', expect.any(Object))
  })

  it('returns 500 when user insert returns null', async () => {
    mockIdTokenVerify(GOOGLE_PAYLOAD)
    mockQueryOne
      .mockResolvedValueOnce(null)   // user lookup → not found
      .mockResolvedValueOnce(null)   // INSERT → null
    const res = await POST(makePost({ idToken: 'valid-token' }) as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/failed to create account/i)
  })

  it('logs in existing user and updates last_login', async () => {
    mockIdTokenVerify(GOOGLE_PAYLOAD)
    mockQueryOne
      .mockResolvedValueOnce(DB_USER) // user lookup → found
      .mockResolvedValueOnce(null)    // guest user
    const res = await POST(makePost({ idToken: 'valid-token' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/login successful/i)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE users SET last_login/),
      expect.any(Array)
    )
  })

  it('returns 403 when existing user is inactive', async () => {
    mockIdTokenVerify(GOOGLE_PAYLOAD)
    mockQueryOne.mockResolvedValueOnce({ ...DB_USER, is_active: false })
    const res = await POST(makePost({ idToken: 'valid-token' }) as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/inactive/i)
  })

  it('links google_id when existing user has none', async () => {
    mockIdTokenVerify(GOOGLE_PAYLOAD)
    mockQueryOne
      .mockResolvedValueOnce({ ...DB_USER, google_id: null })
      .mockResolvedValueOnce(null)
    const res = await POST(makePost({ idToken: 'valid-token' }) as any)
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE users SET google_id/),
      expect.any(Array)
    )
  })

  it('merges guest cart when session_id cookie starts with guest_', async () => {
    mockIdTokenVerify(GOOGLE_PAYLOAD)
    mockCookieStore.get.mockReturnValue({ value: 'guest_abc' })
    mockQueryOne
      .mockResolvedValueOnce(DB_USER)                         // user lookup
      .mockResolvedValueOnce({ id: 'guest-user' })            // guest user
    const res = await POST(makePost({ idToken: 'valid-token' }) as any)
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/merge_guest_cart_to_user/),
      expect.any(Array)
    )
  })

  it('uses accessToken path when no idToken provided', async () => {
    // accessToken flow hits /oauth2/v3/userinfo
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sub: 'google-sub-123',
        email: 'user@example.com',
        given_name: 'Jane',
        email_verified: true,
      }),
    })
    mockQueryOne
      .mockResolvedValueOnce(DB_USER)
      .mockResolvedValueOnce(null)
    const res = await POST(makePost({ accessToken: 'access-token-xyz' }) as any)
    expect(res.status).toBe(200)
  })

  it('returns 401 when accessToken userinfo fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const res = await POST(makePost({ accessToken: 'bad-access-token' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 when accessToken userinfo has email_verified=false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 'g1', email: 'u@u.com', email_verified: false }),
    })
    const res = await POST(makePost({ accessToken: 'at' }) as any)
    expect(res.status).toBe(401)
  })

  it('uploads avatar picture when user has picture url', async () => {
    mockIdTokenVerify({ ...GOOGLE_PAYLOAD, picture: 'https://example.com/avatar.jpg' })
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(DB_USER)
      .mockResolvedValueOnce(null)
    // picture fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })
    mockUploadAvatarImage.mockResolvedValue({ url: 'https://s3.example.com/avatar.jpg', s3Key: 's3-key' })
    const res = await POST(makePost({ idToken: 'valid-token' }) as any)
    expect(res.status).toBe(200)
    expect(mockUploadAvatarImage).toHaveBeenCalled()
  })

  it('returns 500 on unexpected error', async () => {
    mockIdTokenVerify(GOOGLE_PAYLOAD)
    mockQueryOne.mockRejectedValue(new Error('db error'))
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/authentication failed/i)
  })
})
