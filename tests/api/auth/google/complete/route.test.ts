import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'

const mockCookieStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }))
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn())
const mockUploadAvatarImage = vi.hoisted(() => vi.fn())
const mockIssueUserToken = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(mockCookieStore) }))
vi.mock('@/lib/shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, queryMany: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shared/s3', () => ({ uploadAvatarImage: mockUploadAvatarImage }))
vi.mock('@/lib/auth/cookie-domain', () => ({ cookieDomainOption: vi.fn().mockReturnValue({}) }))
vi.mock('@/lib/legals/policies', () => ({ POLICY_VERSION: 'v1' }))
vi.mock('@/lib/auth/issue-session', () => ({
  issueUserToken: mockIssueUserToken,
  USER_SESSION_TTL_S: 3600,
}))
vi.mock('@/lib/auth/session-signals-request', () => ({
  extractSessionSignals: vi.fn().mockReturnValue({}),
}))
vi.mock('@/lib/auth/google-verify', () => ({
  verifyGoogleCredential: vi.fn(),
}))

import { POST } from '@/app/api/(public)/auth/google/complete/route'
import * as gverify from '@/lib/auth/google-verify'

const VALID_DOB = '1990-05-15'

const PROFILE = {
  firstName: 'Jane',
  lastName: 'Doe',
  phone: '+919876543210',
  dateOfBirth: VALID_DOB,
}

const NEW_USER = {
  id: 'u-new',
  email: 'jane@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  phone: '9876543210',
  phone_verified: false,
  date_of_birth: new Date(1990, 4, 15),
}

function makePost(body: object) {
  return new Request('http://localhost/api/auth/google/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

function insertCall() {
  return mockQueryOne.mock.calls.find(c => String(c[0]).includes('INSERT INTO users'))
}

describe('POST /api/auth/google/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockQueryOne.mockReset()
    mockQuery.mockReset().mockResolvedValue({ rows: [] })
    mockCookieStore.get.mockReturnValue(undefined)
    mockIssueUserToken.mockResolvedValue({ sid: 'sid-1' })
    vi.mocked(gverify.verifyGoogleCredential).mockResolvedValue({ sub: 'g-1', email: 'Jane@Example.com' } as any)
  })

  it('401 on an invalid Google token', async () => {
    vi.mocked(gverify.verifyGoogleCredential).mockResolvedValue(null)
    const res = await POST(makePost({ accessToken: 'bad', ...PROFILE }))
    expect(res.status).toBe(401)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('rejects a missing first name', async () => {
    const res = await POST(makePost({ accessToken: 't', ...PROFILE, firstName: '  ' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/first name/i)
  })

  it('rejects an invalid phone', async () => {
    const res = await POST(makePost({ accessToken: 't', ...PROFILE, phone: '123' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/mobile/i)
  })

  it('rejects an invalid date of birth', async () => {
    const underThree = `${new Date().getUTCFullYear() - 1}-01-01`
    const res = await POST(makePost({ accessToken: 't', ...PROFILE, dateOfBirth: underThree }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/date of birth/i)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('409 when an account already exists for the Google identity', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'existing', user_type: 'customer' })
    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    expect(res.status).toBe(409)
    expect(insertCall()).toBeUndefined()
    expect(mockIssueUserToken).not.toHaveBeenCalled()
  })

  it('creates the account from the verified Google email, never the client body', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER)
    const res = await POST(makePost({ accessToken: 't', ...PROFILE, email: 'attacker@example.com' }))
    expect(res.status).toBe(200)

    const insert = insertCall()
    expect(String(insert?.[0])).toContain('date_of_birth')
    expect(insert?.[1]).toEqual(['jane@example.com', 'Jane', 'Doe', '9876543210', 'g-1', 'v1', VALID_DOB])
  })

  it('returns the new user with an unverified phone and starts a session', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER)
    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    const body = await res.json()
    expect(body.user).toMatchObject({
      id: 'u-new',
      email: 'jane@example.com',
      phone: '9876543210',
      phoneVerified: false,
      dateOfBirth: VALID_DOB,
    })
    expect(mockIssueUserToken).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-new', type: 'customer' }))
    expect(mockCookieStore.set).toHaveBeenCalledWith('user_sid', 'sid-1', expect.any(Object))
    expect(mockCookieStore.set).toHaveBeenCalledWith('session_id', 'u-new', expect.any(Object))
  })

  it('409 on a unique violation during insert', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockRejectedValueOnce({ code: '23505' })
    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    expect(res.status).toBe(409)
    expect(mockIssueUserToken).not.toHaveBeenCalled()
  })

  it('saves the Google profile picture as the avatar', async () => {
    vi.mocked(gverify.verifyGoogleCredential).mockResolvedValue({
      sub: 'g-1',
      email: 'jane@example.com',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    } as any)
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER)
    mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
    mockUploadAvatarImage.mockResolvedValue({
      url: 'https://cdn.example.com/avatars/u-new.jpg',
      s3Key: 'avatars/u-new.jpg',
    })

    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    expect(res.status).toBe(200)
    expect(mockUploadAvatarImage).toHaveBeenCalledWith(expect.any(Buffer), 'u-new')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET avatar_url'), [
      'https://cdn.example.com/avatars/u-new.jpg',
      'avatars/u-new.jpg',
      'u-new',
    ])
  })

  it('still creates the account when the avatar upload fails', async () => {
    vi.mocked(gverify.verifyGoogleCredential).mockResolvedValue({
      sub: 'g-1',
      email: 'jane@example.com',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    } as any)
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER)
    mockFetch.mockRejectedValueOnce(new Error('network'))

    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    expect(res.status).toBe(200)
    expect(mockUploadAvatarImage).not.toHaveBeenCalled()
    expect(mockCookieStore.set).toHaveBeenCalledWith('user_sid', 'sid-1', expect.any(Object))
  })

  it('merges the guest cart into the new account', async () => {
    mockCookieStore.get.mockReturnValue({ value: 'guest_abc' })
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER).mockResolvedValueOnce({ id: 'guest-user' })

    const res = await POST(makePost({ accessToken: 't', ...PROFILE }))
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('merge_guest_cart_to_user'), ['guest-user', 'u-new'])
  })
})
