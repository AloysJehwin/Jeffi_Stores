import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/loyalty/queries', () => ({ getLoyaltyStats: vi.fn() }))
vi.mock('@/lib/loyalty/reconcile', () => ({ reconcileLoyaltyUntilDone: vi.fn() }))
vi.mock('@/lib/loyalty/settings', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/loyalty/settings')>()),
  getLoyaltySettings: vi.fn(),
  saveLoyaltySettings: vi.fn(),
}))

import { GET, PUT } from '@controller/app/api/(admin)/admin/loyalty/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getLoyaltyStats } from '@/lib/loyalty/queries'
import { reconcileLoyaltyUntilDone } from '@/lib/loyalty/reconcile'
import { getLoyaltySettings, saveLoyaltySettings } from '@/lib/loyalty/settings'

const mockAuth = authenticateAdmin as ReturnType<typeof vi.fn>
const mockHasScope = hasScope as ReturnType<typeof vi.fn>
const mockStats = getLoyaltyStats as ReturnType<typeof vi.fn>
const mockPasses = reconcileLoyaltyUntilDone as ReturnType<typeof vi.fn>
const mockGet = getLoyaltySettings as ReturnType<typeof vi.fn>
const mockSave = saveLoyaltySettings as ReturnType<typeof vi.fn>

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['campaigns:write'] }

const input = {
  enabled: true,
  rupeesPerPoint: 100,
  pointValue: 1,
  creditDelayDays: 7,
  minRedeemPoints: 100,
  countFrom: null,
  tiers: [
    { key: 'silver', minPoints: 100, multiplier: 1.25 },
    { key: 'gold', minPoints: 500, multiplier: 1.5 },
    { key: 'platinum', minPoints: 1500, multiplier: 2 },
  ],
}

function put(body: unknown) {
  return new NextRequest('http://localhost/api/admin/loyalty', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/admin/loyalty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN)
    mockHasScope.mockReturnValue(true)
    mockGet.mockResolvedValue({ enabled: false, launchedAt: null })
    mockSave.mockResolvedValue(undefined)
    mockPasses.mockResolvedValue({ enabled: true, users: 40, earned: 9645, more: false })
    mockStats.mockResolvedValue({ members: 40 })
  })

  describe('GET', () => {
    const get = () => new NextRequest('http://localhost/api/admin/loyalty')

    it('needs an admin with the campaigns scope', async () => {
      mockAuth.mockResolvedValueOnce(null)
      expect((await GET(get())).status).toBe(401)
      mockHasScope.mockReturnValue(false)
      expect((await GET(get())).status).toBe(403)
      expect(mockHasScope).toHaveBeenCalledWith('admin', ['campaigns:write'], 'campaigns:read')
    })

    it('returns the settings and the member totals', async () => {
      expect(await (await GET(get())).json()).toEqual({
        settings: { enabled: false, launchedAt: null },
        stats: { members: 40 },
      })
    })
  })

  describe('PUT', () => {
    it('needs an admin with write access to campaigns', async () => {
      mockAuth.mockResolvedValueOnce(null)
      expect((await PUT(put(input))).status).toBe(401)
      mockHasScope.mockReturnValue(false)
      expect((await PUT(put(input))).status).toBe(403)
      expect(mockHasScope).toHaveBeenCalledWith('admin', ['campaigns:write'], 'campaigns:write')
      expect(mockSave).not.toHaveBeenCalled()
    })

    it('rejects an invalid form without saving', async () => {
      const res = await PUT(put({ ...input, rupeesPerPoint: 0 }))
      expect(res.status).toBe(400)
      expect((await res.json()).fields).toHaveProperty('rupeesPerPoint')
      expect(mockSave).not.toHaveBeenCalled()
    })

    it('saves the form but keeps the stored on/off, which belongs to Site Controls', async () => {
      mockGet.mockResolvedValue({ enabled: false, launchedAt: null })
      const res = await PUT(put(input))
      expect(res.status).toBe(200)
      const { enabled: _ignored, ...form } = input
      expect(mockSave).toHaveBeenCalledWith({ ...form, enabled: false })
      mockGet.mockResolvedValue({ enabled: true, launchedAt: '2026-10-01' })
      await PUT(put({ ...input, enabled: false }))
      expect(mockSave).toHaveBeenLastCalledWith({ ...form, enabled: true })
    })

    it('never runs the first pass from the settings form', async () => {
      await PUT(put(input))
      expect(mockPasses).not.toHaveBeenCalled()
    })

    it('answers 500 when saving fails', async () => {
      mockSave.mockRejectedValue(new Error('db down'))
      const res = await PUT(put(input))
      expect(res.status).toBe(500)
      expect((await res.json()).error).toBe('db down')
    })
  })
})
