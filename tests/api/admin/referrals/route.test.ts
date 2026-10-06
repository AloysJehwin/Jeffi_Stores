import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))
vi.mock('@/lib/referrals/queries', () => ({ getReferralStats: vi.fn() }))
vi.mock('@/lib/referrals/settings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/referrals/settings')>('@/lib/referrals/settings')
  return { ...actual, getReferralSettings: vi.fn(), saveReferralSettings: vi.fn() }
})

import { GET, PUT } from '@/app/api/(admin)/admin/referrals/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { getReferralStats } from '@/lib/referrals/queries'
import { getReferralSettings, saveReferralSettings } from '@/lib/referrals/settings'

const URL = 'https://admin.test/api/admin/referrals'
const settings = { enabled: true, rewardPoints: 100, yearlyCap: 10, qualifyDays: 90 }
const put = (body: unknown) =>
  PUT(new NextRequest(URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

describe('/api/admin/referrals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getLoyaltySettings).mockResolvedValue({ enabled: true } as any)
    vi.mocked(getReferralSettings).mockResolvedValue(settings)
    vi.mocked(getReferralStats).mockResolvedValue({ signups: 0 } as any)
  })

  it('needs an admin with campaign access to read and write', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await GET(new NextRequest(URL))).status).toBe(401)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(new NextRequest(URL))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', [], 'campaigns:read')
    expect((await put(settings)).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'campaigns:write')
    expect(saveReferralSettings).not.toHaveBeenCalled()
  })

  it('returns settings and stats', async () => {
    expect(await (await GET(new NextRequest(URL))).json()).toEqual({ settings, stats: { signups: 0 } })
  })

  it('saves valid settings', async () => {
    const res = await put({ ...settings, rewardPoints: 150 })
    expect(res.status).toBe(200)
    expect(saveReferralSettings).toHaveBeenCalledWith({ ...settings, rewardPoints: 150 })
  })

  it('rejects out-of-range values before saving', async () => {
    expect((await put({ ...settings, yearlyCap: 0 })).status).toBeGreaterThanOrEqual(400)
    expect(saveReferralSettings).not.toHaveBeenCalled()
  })

  it('refuses to switch referrals on while loyalty is off, but allows turning them off', async () => {
    vi.mocked(getLoyaltySettings).mockResolvedValue({ enabled: false } as any)
    const res = await put(settings)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/loyalty program first/)
    expect(saveReferralSettings).not.toHaveBeenCalled()
    expect((await put({ ...settings, enabled: false })).status).toBe(200)
  })
})
