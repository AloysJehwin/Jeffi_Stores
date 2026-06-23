import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({ verifyAdminCredentials: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/mfa', () => ({ issueMfaTicket: vi.fn() }))
vi.mock('@/lib/admin-session', () => ({ issueAdminSession: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/login/route'
import { verifyAdminCredentials } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { issueMfaTicket } from '@/lib/mfa'
import { issueAdminSession } from '@/lib/admin-session'

const mockVerify = vi.mocked(verifyAdminCredentials)
const mockQueryOne = vi.mocked(queryOne)
const mockIssueMfaTicket = vi.mocked(issueMfaTicket)
const mockIssueAdminSession = vi.mocked(issueAdminSession)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const adminResult = {
  success: true,
  admin: { id: 'admin-1', username: 'testadmin', role: 'admin' },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: non-production (test mode)
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 400 when username missing', async () => {
    const res = await POST(makeRequest({ password: 'pass' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Username and password are required')
  })

  it('returns 400 when password missing', async () => {
    const res = await POST(makeRequest({ username: 'admin' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Username and password are required')
  })

  it('returns 400 when both credentials missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 when credentials invalid', async () => {
    mockVerify.mockResolvedValueOnce({ success: false, error: 'Invalid credentials' } as any)
    const res = await POST(makeRequest({ username: 'admin', password: 'wrong' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid credentials')
  })

  it('returns 401 when verifyAdminCredentials returns no admin', async () => {
    mockVerify.mockResolvedValueOnce({ success: true, admin: null } as any)
    const res = await POST(makeRequest({ username: 'admin', password: 'pass' }))
    expect(res.status).toBe(401)
  })

  // Development (non-production) path
  describe('development / test mode', () => {
    it('returns session directly when admin row found and no MFA enrolled', async () => {
      mockVerify.mockResolvedValueOnce(adminResult as any)
      mockQueryOne.mockResolvedValueOnce({
        id: 'admin-1', username: 'testadmin', first_name: 'Test', last_name: 'Admin', role: 'admin', scopes: ['orders'],
      } as any)
      const sessionResponse = new Response(JSON.stringify({ token: 'sess-token' }), { status: 200 })
      mockIssueAdminSession.mockResolvedValueOnce(sessionResponse as any)

      const res = await POST(makeRequest({ username: 'testadmin', password: 'pass' }))
      expect(mockIssueAdminSession).toHaveBeenCalled()
    })

    it('returns 401 when admin row not found in development', async () => {
      mockVerify.mockResolvedValueOnce(adminResult as any)
      mockQueryOne.mockResolvedValueOnce(null)
      const res = await POST(makeRequest({ username: 'testadmin', password: 'pass' }))
      expect(res.status).toBe(401)
      expect((await res.json()).error).toBe('Admin not found')
    })
  })

  // Production path
  describe('production mode', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production')
    })

    it('returns 403 in production when no client cert present', async () => {
      mockVerify.mockResolvedValueOnce(adminResult as any)
      const res = await POST(makeRequest({ username: 'testadmin', password: 'pass' }))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toContain('client certificate')
    })

    it('returns 403 when cert serial not found in DB', async () => {
      mockVerify.mockResolvedValueOnce(adminResult as any)
      mockQueryOne.mockResolvedValueOnce(null) // cert not found
      const res = await POST(
        makeRequest({ username: 'testadmin', password: 'pass' }, { 'x-client-cert-serial': 'ABC123' })
      )
      expect(res.status).toBe(403)
      expect((await res.json()).error).toContain('not recognized or expired')
    })

    it('returns 403 when cert belongs to non-super-admin but login is for super_admin', async () => {
      mockVerify.mockResolvedValueOnce({ success: true, admin: { id: 'admin-1', username: 'sa', role: 'super_admin' } } as any)
      mockQueryOne
        .mockResolvedValueOnce({ admin_id: 'admin-1' } as any)  // cert found
        .mockResolvedValueOnce({ role: 'admin' } as any)         // cert owner role = regular admin
      const res = await POST(
        makeRequest({ username: 'sa', password: 'pass' }, { 'x-client-cert-serial': 'ABC123' })
      )
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('Certificate not authorized for this account')
    })

    it('proceeds to MFA when cert is valid and MFA enabled', async () => {
      mockVerify.mockResolvedValueOnce(adminResult as any)
      mockQueryOne
        .mockResolvedValueOnce({ admin_id: 'admin-1' } as any)   // cert found
        .mockResolvedValueOnce({ role: 'admin' } as any)          // cert owner role
        .mockResolvedValueOnce({ mfa_enabled: true } as any)      // MFA check
      mockIssueMfaTicket.mockResolvedValueOnce('mfa-ticket-xyz' as any)

      const res = await POST(
        makeRequest({ username: 'testadmin', password: 'pass' }, { 'x-client-cert-serial': 'ABC123' })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.mfa_required).toBe(true)
      expect(body.ticket).toBe('mfa-ticket-xyz')
    })

    it('requires MFA enrollment when cert valid but MFA not enabled', async () => {
      mockVerify.mockResolvedValueOnce(adminResult as any)
      mockQueryOne
        .mockResolvedValueOnce({ admin_id: 'admin-1' } as any)   // cert found
        .mockResolvedValueOnce({ role: 'admin' } as any)          // cert owner role
        .mockResolvedValueOnce({ mfa_enabled: false } as any)     // MFA not enabled
      mockIssueMfaTicket.mockResolvedValueOnce('enroll-ticket-xyz' as any)

      const res = await POST(
        makeRequest({ username: 'testadmin', password: 'pass' }, { 'x-client-cert-serial': 'ABC123' })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.enroll_required).toBe(true)
      expect(body.ticket).toBe('enroll-ticket-xyz')
    })

    it('uses cert CN path when serial is absent but CN present', async () => {
      mockVerify.mockResolvedValueOnce(adminResult as any)
      mockQueryOne
        .mockResolvedValueOnce({ id: 'admin-1', role: 'admin' } as any) // cert owner by CN
        .mockResolvedValueOnce({ mfa_enabled: true } as any)             // MFA check
      mockIssueMfaTicket.mockResolvedValueOnce('ticket-cn' as any)

      const res = await POST(
        makeRequest({ username: 'testadmin', password: 'pass' }, { 'x-client-cert-cn': 'testadmin' })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.mfa_required).toBe(true)
    })

    it('returns 403 when CN not found in DB', async () => {
      mockVerify.mockResolvedValueOnce(adminResult as any)
      mockQueryOne.mockResolvedValueOnce(null) // CN not found
      const res = await POST(
        makeRequest({ username: 'testadmin', password: 'pass' }, { 'x-client-cert-cn': 'unknowncn' })
      )
      expect(res.status).toBe(403)
      expect((await res.json()).error).toContain('not recognized')
    })
  })

  it('returns 500 on unexpected error', async () => {
    mockVerify.mockRejectedValueOnce(new Error('DB crash'))
    const res = await POST(makeRequest({ username: 'admin', password: 'pass' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Internal server error')
  })
})
