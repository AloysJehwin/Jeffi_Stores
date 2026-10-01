import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/icon-suggest', () => ({
  suggestIcon: vi.fn(),
}))

import { POST } from '@/app/api/(admin)/admin/categories/suggest-icon/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { suggestIcon } from '@/lib/shared/icon-suggest'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockSuggestIcon = vi.mocked(suggestIcon)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['categories'] }

function makeReq(body: any) {
  return new NextRequest('http://localhost/api/admin/categories/suggest-icon', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/admin/categories/suggest-icon', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ name: 'tools' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq({ name: 'tools' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name/)
  })

  it('returns 400 when name is blank', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeReq({ name: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns iconName on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSuggestIcon.mockResolvedValue('wrench')
    const res = await POST(makeReq({ name: 'tools' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.iconName).toBe('wrench')
    expect(mockSuggestIcon).toHaveBeenCalledWith('tools')
  })
})
