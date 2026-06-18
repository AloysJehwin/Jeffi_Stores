import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures variables are defined before vi.mock() factories
// ---------------------------------------------------------------------------
const { mockDelete, mockCookies, mockGet, mockHeaders, mockRedirect, mockAp } =
  vi.hoisted(() => {
    const mockDelete = vi.fn()
    const mockGet = vi.fn()
    return {
      mockDelete,
      mockCookies: vi.fn().mockReturnValue({ delete: mockDelete }),
      mockGet,
      mockHeaders: vi.fn().mockResolvedValue({ get: mockGet }),
      mockRedirect: vi.fn(),
      mockAp: vi.fn(),
    }
  })

vi.mock('next/headers', () => ({
  cookies: mockCookies,
  headers: mockHeaders,
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/admin-path', () => ({
  ap: mockAp,
}))

import { logoutAction } from '@/app/admin/logout-action'

describe('logoutAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue(null)
    mockAp.mockReturnValue('/admin/login')
  })

  it('deletes admin_token cookie', async () => {
    await logoutAction()
    expect(mockDelete).toHaveBeenCalledWith('admin_token')
  })

  it('deletes admin_session cookie', async () => {
    await logoutAction()
    expect(mockDelete).toHaveBeenCalledWith('admin_session')
  })

  it('reads the host header', async () => {
    mockGet.mockReturnValue('admin.jeffistores.in')
    await logoutAction()
    expect(mockGet).toHaveBeenCalledWith('host')
  })

  it('calls ap() with /admin/login and the host', async () => {
    mockGet.mockReturnValue('admin.jeffistores.in')
    mockAp.mockReturnValue('/login')
    await logoutAction()
    expect(mockAp).toHaveBeenCalledWith('/admin/login', 'admin.jeffistores.in')
  })

  it('calls redirect() with the result from ap()', async () => {
    mockAp.mockReturnValue('/login')
    await logoutAction()
    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('passes empty string host when host header is null', async () => {
    mockGet.mockReturnValue(null)
    await logoutAction()
    expect(mockAp).toHaveBeenCalledWith('/admin/login', '')
  })
})
