import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures variables are defined before vi.mock() factories
// ---------------------------------------------------------------------------
const { mockDelete, mockCookies, mockGetHost, mockRedirect, mockAp } =
  vi.hoisted(() => {
    const mockDelete = vi.fn()
    return {
      mockDelete,
      mockCookies: vi.fn().mockReturnValue({ delete: mockDelete }),
      mockGetHost: vi.fn().mockResolvedValue(''),
      mockRedirect: vi.fn(),
      mockAp: vi.fn(),
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

import { logoutAction } from '@/app/admin/logout-action'

describe('logoutAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetHost.mockResolvedValue('')
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
})
