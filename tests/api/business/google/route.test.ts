/**
 * Tests for POST /api/business/google
 * src/app/api/business/google/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}))

vi.mock('@/lib/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/activity', () => ({
  logActivity: mockLogActivity,
}))

vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from '@/app/api/business/google/route'
import { cookies } from 'next/headers'

// ── helpers ───────────────────────────────────────────────────────────────────
function makePost(body: object) {
  return new Request('http://localhost/api/business/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const GOOGLE_PAYLOAD = {
  sub: 'biz-google-sub',
  email: 'biz@example.com',
  given_name: 'Biz',
  family_name: 'Owner',
  name: 'Biz Owner',
  aud: 'test-google-client-id',
}

const BIZ_PROFILE_FIELDS = {
  companyName: 'Acme Ltd',
  gstNumber: '27AAPFU0939F1ZV',
  businessAddress: '123 Main St',
  industry: 'Manufacturing',
}

const APPROVED_USER = {
  id: 'biz-user-1',
  email: 'biz@example.com',
  first_name: 'Biz',
  last_name: 'Owner',
  phone: '9876543210',
  is_active: true,
  google_id: 'biz-google-sub',
  approval_status: 'approved',
  company_name: 'Acme Ltd',
}

function mockIdTokenOk(payload = GOOGLE_PAYLOAD) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload })
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/business/google', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    vi.mocked(cookies).mockResolvedValue(mockCookieStore as any)
    mockCookieStore.get.mockReturnValue(undefined)
    mockQuery.mockResolvedValue({ rows: [] })
    mockLogActivity.mockResolvedValue(undefined)
  })

  it('returns 400 when neither idToken nor accessToken provided', async () => {
    const res = await POST(makePost({}) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/idToken or accessToken required/i)
  })

  it('returns 401 when google token is invalid', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const res = await POST(makePost({ idToken: 'bad' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns needsBusinessProfile=true for new user without profile fields', async () => {
    mockIdTokenOk()
    mockQueryOne.mockResolvedValue(null) // user not found
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.needsBusinessProfile).toBe(true)
    expect(body.email).toBe('biz@example.com')
  })

  it('creates new business user when profile fields provided', async () => {
    mockIdTokenOk()
    const newUser = { ...APPROVED_USER, approval_status: 'pending' }
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing user
      .mockResolvedValueOnce(newUser) // INSERT user
    const res = await POST(makePost({ idToken: 'token', ...BIZ_PROFILE_FIELDS }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    // New users pending approval get approvalStatus back, not a full login
    expect(body.approvalStatus).toBe('pending')
    expect(body.message).toMatch(/awaiting approval/i)
  })

  it('returns 500 when user insert fails', async () => {
    mockIdTokenOk()
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing user
      .mockResolvedValueOnce(null) // insert fails
    const res = await POST(makePost({ idToken: 'token', ...BIZ_PROFILE_FIELDS }) as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/failed to create account/i)
  })

  it('returns 403 for inactive existing user', async () => {
    mockIdTokenOk()
    mockQueryOne.mockResolvedValue({ ...APPROVED_USER, is_active: false })
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/inactive/i)
  })

  it('returns approvalStatus=pending for pending existing user', async () => {
    mockIdTokenOk()
    mockQueryOne.mockResolvedValue({ ...APPROVED_USER, approval_status: 'pending' })
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.approvalStatus).toBe('pending')
    expect(body.message).toMatch(/awaiting approval/i)
  })

  it('returns approvalStatus=rejected with rejection message', async () => {
    mockIdTokenOk()
    mockQueryOne.mockResolvedValue({ ...APPROVED_USER, approval_status: 'rejected' })
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.approvalStatus).toBe('rejected')
    expect(body.message).toMatch(/not approved/i)
  })

  it('logs in approved user and sets cookies', async () => {
    mockIdTokenOk()
    mockQueryOne.mockResolvedValue(APPROVED_USER)
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/login successful/i)
    expect(body.approvalStatus).toBe('approved')
    expect(body.user.email).toBe('biz@example.com')
    expect(mockCookieStore.set).toHaveBeenCalledWith('business_sid', expect.any(String), expect.any(Object))
  })

  it('links google_id for existing user that lacks it', async () => {
    mockIdTokenOk()
    mockQueryOne.mockResolvedValue({ ...APPROVED_USER, google_id: null })
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE users SET google_id/), expect.any(Array))
  })

  it('uses accessToken path when no idToken provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sub: 'biz-google-sub',
        email: 'biz@example.com',
        given_name: 'Biz',
        email_verified: true,
      }),
    })
    mockQueryOne.mockResolvedValue(APPROVED_USER)
    const res = await POST(makePost({ accessToken: 'acc-token' }) as any)
    expect(res.status).toBe(200)
  })

  it('returns 500 on unexpected error', async () => {
    mockIdTokenOk()
    mockQueryOne.mockRejectedValue(new Error('db error'))
    const res = await POST(makePost({ idToken: 'token' }) as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/authentication failed/i)
  })
})
