import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures variables are defined before vi.mock() factories
// ---------------------------------------------------------------------------
const {
  mockDelete,
  mockGet,
  mockCookies,
  mockGetHost,
  mockRedirect,
  mockAp,
  mockVerifyToken,
  mockRevokeSession,
  mockRevokeAll,
} = vi.hoisted(() => {
  const mockDelete = vi.fn()
  const mockGet = vi.fn().mockReturnValue(undefined)
  return {
    mockDelete,
    mockGet,
    mockCookies: vi.fn().mockReturnValue({ delete: mockDelete, get: mockGet }),
    mockGetHost: vi.fn().mockResolvedValue(''),
    mockRedirect: vi.fn(),
    mockAp: vi.fn(),
    mockVerifyToken: vi.fn().mockResolvedValue(null),
    mockRevokeSession: vi.fn().mockResolvedValue(undefined),
    mockRevokeAll: vi.fn().mockResolvedValue(1),
  }
})

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}))

vi.mock('@/lib/get-host', () => ({
  getHost: mockGetHost,
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/admin-path', () => ({
  ap: mockAp,
}))

// Opaque sessions: logout resolves the admin_sid cookie via verifyToken and
// revokes the server-side session before clearing the cookie.
vi.mock('@/lib/jwt', () => ({
  verifyToken: mockVerifyToken,
}))

vi.mock('@/lib/auth-sessions', () => ({
  revokeSession: mockRevokeSession,
  revokeAllForPrincipal: mockRevokeAll,
}))

import { logoutAction } from '@/app/admin/logout-action'

describe('logoutAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetHost.mockResolvedValue('')
    mockAp.mockReturnValue('/admin/login')
    mockGet.mockReturnValue(undefined)
    mockVerifyToken.mockResolvedValue(null)
    mockRevokeSession.mockResolvedValue(undefined)
  })

  it('deletes admin_sid cookie', async () => {
    await logoutAction()
    expect(mockDelete).toHaveBeenCalledWith('admin_sid')
  })

  it('deletes admin_session cookie', async () => {
    await logoutAction()
    expect(mockDelete).toHaveBeenCalledWith('admin_session')
  })

  it('calls getHost()', async () => {
    mockGetHost.mockResolvedValue('admin.jeffistores.in')
    await logoutAction()
    expect(mockGetHost).toHaveBeenCalled()
  })

  it('calls ap() with /admin/login and the host', async () => {
    mockGetHost.mockResolvedValue('admin.jeffistores.in')
    mockAp.mockReturnValue('/login')
    await logoutAction()
    expect(mockAp).toHaveBeenCalledWith('/admin/login', 'admin.jeffistores.in')
  })

  it('calls redirect() with the result from ap()', async () => {
    mockAp.mockReturnValue('/login')
    await logoutAction()
    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('passes empty string host when getHost returns empty', async () => {
    mockGetHost.mockResolvedValue('')
    await logoutAction()
    expect(mockAp).toHaveBeenCalledWith('/admin/login', '')
  })

  it('ends every admin session of the account behind the admin_sid cookie', async () => {
    mockGet.mockReturnValue({ value: 'the-cookie-sid' })
    mockVerifyToken.mockResolvedValue({
      adminId: 'admin-1',
      sid: 'admin-sid',
      role: 'admin',
      scopes: [],
    })
    await logoutAction()
    expect(mockVerifyToken).toHaveBeenCalledWith('the-cookie-sid')
    expect(mockRevokeAll).toHaveBeenCalledWith('admin', 'admin-1')
    expect(mockRevokeSession).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith('admin_sid')
    expect(mockRedirect).toHaveBeenCalled()
  })

  it('does not revoke a session when there is no admin_sid cookie', async () => {
    mockGet.mockReturnValue(undefined)
    await logoutAction()
    expect(mockVerifyToken).not.toHaveBeenCalled()
    expect(mockRevokeSession).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith('admin_sid')
  })
})
