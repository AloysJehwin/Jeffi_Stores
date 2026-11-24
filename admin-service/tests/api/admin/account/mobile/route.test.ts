import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/admin-mobile', () => ({ adminMobile: vi.fn(), maskMobile: vi.fn((m: string) => `***${m.slice(-4)}`) }))

import { GET } from '@admin/app/api/(admin)/admin/account/mobile/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { adminMobile } from '@/lib/auth/admin-mobile'

const req = () => new NextRequest('http://localhost/api/admin/account/mobile')

describe('GET /api/admin/account/mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  })

  it('401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
    expect(adminMobile).not.toHaveBeenCalled()
  })

  it('returns the masked verified number', async () => {
    vi.mocked(adminMobile).mockResolvedValue({ mobile: '+919876543210', mobile_verified_at: '2026-11-01T00:00:00Z' } as any)
    const j = await (await GET(req())).json()
    expect(adminMobile).toHaveBeenCalledWith('a1')
    expect(j).toEqual({ mobile: '***3210', verifiedAt: '2026-11-01T00:00:00Z' })
  })

  it('hides an unverified number', async () => {
    vi.mocked(adminMobile).mockResolvedValue({ mobile: '+919876543210', mobile_verified_at: null } as any)
    expect(await (await GET(req())).json()).toEqual({ mobile: null, verifiedAt: null })
  })

  it('handles no row', async () => {
    vi.mocked(adminMobile).mockResolvedValue(null as any)
    expect(await (await GET(req())).json()).toEqual({ mobile: null, verifiedAt: null })
  })
})
