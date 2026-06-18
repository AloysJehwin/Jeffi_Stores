import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock next/headers and next/navigation before imports
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/lib/admin-path', () => ({
  ap: vi.fn((path: string) => path),
}))

import { requireAuth } from '@/lib/auth-guard'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

const mockCookies = vi.mocked(cookies)
const mockHeaders = vi.mocked(headers)
const mockRedirect = vi.mocked(redirect)

function makeHeaders(host = 'admin.example.com') {
  return {
    get: vi.fn().mockImplementation((key: string) => (key === 'host' ? host : null)),
  } as any
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedirect.mockImplementation(() => { throw new Error('REDIRECT') })
  })

  it('redirects to login when no session cookie', async () => {
    mockCookies.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) } as any)
    mockHeaders.mockResolvedValue(makeHeaders() as any)
    await expect(requireAuth()).rejects.toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringContaining('/admin/login'))
  })

  it('redirects when session is expired', async () => {
    const expired = JSON.stringify({ id: 'admin-1', exp: Date.now() - 10000 })
    mockCookies.mockReturnValue({ get: vi.fn().mockReturnValue({ value: expired }) } as any)
    mockHeaders.mockResolvedValue(makeHeaders() as any)
    await expect(requireAuth()).rejects.toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalled()
  })

  it('redirects when session cookie value is not valid JSON', async () => {
    mockCookies.mockReturnValue({ get: vi.fn().mockReturnValue({ value: 'not-json' }) } as any)
    mockHeaders.mockResolvedValue(makeHeaders() as any)
    await expect(requireAuth()).rejects.toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalled()
  })

  it('returns session data for valid non-expired session', async () => {
    const sessionData = { id: 'admin-1', role: 'admin', exp: Date.now() + 60000 }
    mockCookies.mockReturnValue({
      get: vi.fn().mockReturnValue({ value: JSON.stringify(sessionData) }),
    } as any)
    mockHeaders.mockResolvedValue(makeHeaders() as any)
    const result = await requireAuth()
    expect(result.id).toBe('admin-1')
    expect(result.role).toBe('admin')
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
