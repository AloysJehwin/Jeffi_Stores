import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  generateToken: vi.fn().mockResolvedValue('mock-jwt-token'),
  JWT_MAX_AGE_S: 3600,
}))

vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

vi.mock('next/server', () => {
  const mockSet = vi.fn()
  const MockNextResponse = {
    json: vi.fn().mockImplementation((body: unknown) => ({
      body,
      cookies: { set: mockSet },
      _mockCookieSet: mockSet,
    })),
  }
  return { NextResponse: MockNextResponse }
})

import { issueAdminSession } from '@/lib/admin-session'
import { generateToken } from '@/lib/jwt'
import { NextResponse } from 'next/server'

const mockGenerateToken = vi.mocked(generateToken)

describe('issueAdminSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateToken.mockResolvedValue('mock-jwt-token')
  })

  it('calls generateToken with admin fields', async () => {
    const admin = { id: 'admin-1', username: 'alice', role: 'superadmin', scopes: ['read', 'write'] }
    await issueAdminSession(admin)
    expect(mockGenerateToken).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: 'admin-1', username: 'alice', role: 'superadmin' })
    )
  })

  it('sets admin_token cookie on the response', async () => {
    const admin = { id: 'admin-2', username: 'bob', role: 'admin', scopes: null }
    const response = await issueAdminSession(admin)
    const mockSet = (response as any)._mockCookieSet ?? (response.cookies as any).set
    expect(mockSet).toHaveBeenCalledWith(
      'admin_token',
      'mock-jwt-token',
      expect.objectContaining({ httpOnly: true, path: '/' })
    )
  })

  it('returns NextResponse.json with success:true', async () => {
    const admin = { id: 'a1', username: 'test', role: 'admin', scopes: [] }
    const response = await issueAdminSession(admin)
    expect(NextResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )
    expect(response).toBeDefined()
  })

  it('includes certCN in token when provided', async () => {
    const admin = { id: 'a1', username: 'test', role: 'admin', scopes: [] }
    await issueAdminSession(admin, 'client-cert-cn')
    expect(mockGenerateToken).toHaveBeenCalledWith(
      expect.objectContaining({ authCertCN: 'client-cert-cn' })
    )
  })

  it('merges extraBody into response body', async () => {
    const admin = { id: 'a1', username: 'test', role: 'admin', scopes: [] }
    await issueAdminSession(admin, undefined, { redirectTo: '/dashboard' })
    expect(NextResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ redirectTo: '/dashboard' })
    )
  })

  it('handles null scopes by defaulting to empty array', async () => {
    const admin = { id: 'a1', username: 'test', role: 'admin', scopes: null }
    await issueAdminSession(admin)
    expect(mockGenerateToken).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: [] })
    )
  })
})
