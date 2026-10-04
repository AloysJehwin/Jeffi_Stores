/**
 * Tests for POST /api/business/google/complete
 * src/app/api/(public)/business/google/complete/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'

const mockCookieStore = vi.hoisted(() => ({ get: vi.fn().mockReturnValue(undefined), set: vi.fn(), delete: vi.fn() }))
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }))

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(mockCookieStore) }))
vi.mock('@/lib/shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, queryMany: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/auth/cookie-domain', () => ({ cookieDomainOption: vi.fn().mockReturnValue({}) }))
vi.mock('@/lib/auth/issue-session', () => ({
  issueUserToken: vi.fn().mockResolvedValue({ sid: 'sid-1' }),
  USER_SESSION_TTL_S: 3600,
}))
vi.mock('@/lib/auth/session-signals-request', () => ({
  extractSessionSignals: vi.fn().mockReturnValue({}),
}))
vi.mock('@/lib/auth/google-verify', () => ({
  verifyGoogleCredential: vi.fn(),
}))

import { POST } from '@/app/api/(public)/business/google/complete/route'
import * as gverify from '@/lib/auth/google-verify'

// A valid DOB ~30 years ago (passes the 3..120 bound and the not-future check).
const VALID_DOB = `${new Date().getUTCFullYear() - 30}-02-04`

const PROFILE = {
  firstName: 'Biz',
  lastName: 'Owner',
  phone: '+919000000000',
  dateOfBirth: VALID_DOB,
  companyName: 'Acme Pvt Ltd',
  gstNumber: '22AAAAA0000A1Z5',
  businessAddress: '1 Street, City, State, 560001',
  industry: 'Manufacturing',
}

function makePost(body: object) {
  return new Request('http://localhost/api/business/google/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

describe('POST /api/business/google/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
    vi.mocked(gverify.verifyGoogleCredential).mockResolvedValue({ sub: 'g-1', email: 'biz@example.com' } as any)
  })

  it('401 on invalid Google token', async () => {
    vi.mocked(gverify.verifyGoogleCredential).mockResolvedValue(null)
    const res = await POST(makePost({ accessToken: 'bad', ...PROFILE }))
    expect(res.status).toBe(401)
  })

  it('rejects an invalid date of birth', async () => {
    const underThree = `${new Date().getUTCFullYear() - 1}-01-01`
    const res = await POST(makePost({ accessToken: 't', ...PROFILE, dateOfBirth: underThree }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/date of birth/i)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects an invalid phone', async () => {
    const res = await POST(makePost({ accessToken: 't', ...PROFILE, phone: '123' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/mobile/i)
  })

  it('rejects missing business fields', async () => {
    const res = await POST(makePost({ accessToken: 't', ...PROFILE, companyName: '' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/business fields/i)
  })

  it('409 when a business account already exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'existing' }) // existing lookup
    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    expect(res.status).toBe(409)
  })

  it('creates the account (phone_verified=false, DOB set) + business profile, pending approval', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing business user
      .mockResolvedValueOnce({
        id: 'u-new',
        email: 'biz@example.com',
        first_name: 'Biz',
        last_name: 'Owner',
        phone: '9000000000',
        phone_verified: false,
        date_of_birth: VALID_DOB,
      }) // INSERT users RETURNING *
    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.approvalStatus).toBe('pending')
    expect(body.user.phoneVerified).toBe(false)
    // users INSERT carries date_of_birth; business_profiles INSERT ran; session cookie set.
    const insertUsers = mockQueryOne.mock.calls.find(c => String(c[0]).includes('INSERT INTO users'))
    expect(insertUsers).toBeTruthy()
    expect(String(insertUsers![0])).toContain('date_of_birth')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO business_profiles'), expect.anything())
    expect(mockCookieStore.set).toHaveBeenCalled()
  })

  it('409 on a unique-violation during insert', async () => {
    mockQueryOne.mockResolvedValueOnce(null) // no existing
    mockQueryOne.mockRejectedValueOnce({ code: '23505' })
    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    expect(res.status).toBe(409)
  })
})
