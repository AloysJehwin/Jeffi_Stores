import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  verifyAdminCredentials: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/mfa', () => ({
  issueMfaTicket: vi.fn(),
  verifyMfaTicket: vi.fn(),
}))

vi.mock('@/lib/admin-session', () => ({
  issueAdminSession: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/login/route'
import { verifyAdminCredentials } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { issueMfaTicket } from '@/lib/mfa'
import { issueAdminSession } from '@/lib/admin-session'
import { NextResponse } from 'next/server'

const mockVerify = vi.mocked(verifyAdminCredentials)
const mockQueryOne = vi.mocked(queryOne)
const mockIssueMfaTicket = vi.mocked(issueMfaTicket)
const mockIssueAdminSession = vi.mocked(issueAdminSession)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const adminCredResult = {
  success: true,
  admin: {
    id: 'admin-1',
    user_id: 'user-1',
    username: 'testadmin',
    role: 'admin',
    scopes: ['products'],
    email: 'admin@test.com',
    first_name: 'Test',
    last_name: 'Admin',
  },
}

const adminRow = {
  id: 'admin-1',
  username: 'testadmin',
  first_name: 'Test',
  last_name: 'Admin',
  role: 'admin',
  scopes: ['products'],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/login', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 400 when username is missing', async () => {
    const req = makeRequest({ password: 'secret' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
  })

  it('returns 400 when password is missing', async () => {
    const req = makeRequest({ username: 'admin' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
  })

  it('returns 401 on wrong password', async () => {
    mockVerify.mockResolvedValue({ success: false, error: 'Invalid credentials' })
    const req = makeRequest({ username: 'admin', password: 'wrong' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/invalid/i)
  })

  // Non-production path: skips cert + MFA checks, goes straight to issueAdminSession
  it('issues session directly in non-production environment', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockVerify.mockResolvedValue(adminCredResult)
    mockQueryOne.mockResolvedValue(adminRow)
    const sessionResponse = NextResponse.json({ success: true, admin: { username: 'testadmin', role: 'admin' } })
    mockIssueAdminSession.mockResolvedValue(sessionResponse)

    const req = makeRequest({ username: 'testadmin', password: 'correct' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockIssueAdminSession).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'testadmin' }),
      undefined,
    )
  })

  it('returns 401 when admin row not found in non-production path', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockVerify.mockResolvedValue(adminCredResult)
    mockQueryOne.mockResolvedValue(null)

    const req = makeRequest({ username: 'testadmin', password: 'correct' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 403 in production without cert', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockVerify.mockResolvedValue(adminCredResult)

    const req = makeRequest({ username: 'testadmin', password: 'correct' })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/certificate/i)
  })

  it('returns mfa_required ticket in production when MFA is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockVerify.mockResolvedValue(adminCredResult)
    mockQueryOne
      .mockResolvedValueOnce({ admin_id: 'admin-1' })   // cert lookup
      .mockResolvedValueOnce({ role: 'admin' })          // cert owner role
      .mockResolvedValueOnce({ mfa_enabled: true })      // mfa row

    mockIssueMfaTicket.mockResolvedValue('mfa-ticket-abc')

    const req = makeRequest(
      { username: 'testadmin', password: 'correct' },
      { 'x-client-cert-serial': 'ABCDEF1234' },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mfa_required).toBe(true)
    expect(body.ticket).toBe('mfa-ticket-abc')
  })

  it('returns enroll_required in production when MFA not yet enrolled', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockVerify.mockResolvedValue(adminCredResult)
    mockQueryOne
      .mockResolvedValueOnce({ admin_id: 'admin-1' })
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ mfa_enabled: false })

    mockIssueMfaTicket.mockResolvedValue('enroll-ticket-xyz')

    const req = makeRequest(
      { username: 'testadmin', password: 'correct' },
      { 'x-client-cert-serial': 'ABCDEF1234' },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enroll_required).toBe(true)
    expect(body.ticket).toBe('enroll-ticket-xyz')
  })

  it('returns 500 on unexpected error', async () => {
    mockVerify.mockRejectedValue(new Error('DB exploded'))
    const req = makeRequest({ username: 'admin', password: 'pass' })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/internal/i)
  })
})
