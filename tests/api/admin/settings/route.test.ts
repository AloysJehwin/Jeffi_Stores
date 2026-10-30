import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/shipping/delivery-settings', () => ({ invalidateDeliverySettingsCache: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))
vi.mock('@/lib/loyalty/reconcile', () => ({ reconcileLoyaltyUntilDone: vi.fn() }))

import { PATCH } from '@controller/app/api/(admin)/admin/settings/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { invalidateDeliverySettingsCache } from '@/lib/shipping/delivery-settings'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { reconcileLoyaltyUntilDone } from '@/lib/loyalty/reconcile'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockInvalidate = vi.mocked(invalidateDeliverySettingsCache)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['settings'] }

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PATCH /api/admin/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeRequest({ key: 'min_order_amount', value: '100' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makeRequest({ key: 'min_order_amount', value: '100' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 400 for non-editable key', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makeRequest({ key: 'secret_key', value: 'hack' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not editable/i)
  })

  it('rejects the messaging provider keys: the platform manages them', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    for (const key of ['feature_sms_provider', 'feature_whatsapp_provider']) {
      const res = await PATCH(makeRequest({ key, value: 'aws' }))
      expect(res.status).toBe(400)
      const batch = await PATCH(makeRequest({ updates: [{ key, value: 'aws' }] }))
      expect(batch.status).toBe(400)
    }
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('updates editable key and returns success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makeRequest({ key: 'min_order_amount', value: 500 }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO site_settings'), [
      'min_order_amount',
      '500',
    ])
  })

  it('invalidates delivery cache for delivery_ keys', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await PATCH(makeRequest({ key: 'delivery_charges_enabled', value: 'true' }))
    expect(mockInvalidate).toHaveBeenCalledOnce()
  })

  it('does not invalidate delivery cache for non-delivery keys', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await PATCH(makeRequest({ key: 'min_order_amount', value: '100' }))
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('invalidates cache for all delivery_ prefixed keys', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const deliveryKeys = [
      'delivery_charges_enabled',
      'delivery_free_threshold',
      'delivery_rate_per_kg',
      'delivery_free_weight_ceiling_kg',
    ]

    for (const key of deliveryKeys) {
      vi.clearAllMocks()
      mockAuth.mockResolvedValue(admin)
      mockHasScope.mockReturnValue(true)
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
      await PATCH(makeRequest({ key, value: 'test' }))
      expect(mockInvalidate).toHaveBeenCalledOnce()
    }
  })

  it('returns 500 on database error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockRejectedValue(new Error('DB error'))

    const res = await PATCH(makeRequest({ key: 'min_order_amount', value: '100' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/failed to update/i)
  })

  describe('customer program switches', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(admin as any)
      mockHasScope.mockReturnValue(true)
      mockQuery.mockResolvedValue(undefined as any)
    })

    it('refuses to switch Refer & Earn on while loyalty is off, in single and batch mode', async () => {
      vi.mocked(getLoyaltySettings).mockResolvedValue({ enabled: false } as any)
      const single = await PATCH(makeRequest({ key: 'referral_enabled', value: 'true' }))
      expect(single.status).toBe(400)
      expect((await single.json()).error).toMatch(/loyalty program first/)
      const batch = await PATCH(makeRequest({ updates: [{ key: 'referral_enabled', value: 'true' }] }))
      expect(batch.status).toBe(400)
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('lets Refer & Earn be switched on with loyalty on, and off at any time', async () => {
      vi.mocked(getLoyaltySettings).mockResolvedValue({ enabled: true } as any)
      expect((await PATCH(makeRequest({ key: 'referral_enabled', value: 'true' }))).status).toBe(200)
      vi.mocked(getLoyaltySettings).mockResolvedValue({ enabled: false } as any)
      expect((await PATCH(makeRequest({ key: 'referral_enabled', value: 'false' }))).status).toBe(200)
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('counts past orders silently the first time Loyalty is switched on', async () => {
      vi.mocked(getLoyaltySettings).mockResolvedValue({ enabled: true, launchedAt: null } as any)
      vi.mocked(reconcileLoyaltyUntilDone).mockResolvedValue({ users: 40, earned: 9645 } as any)
      const res = await PATCH(makeRequest({ key: 'loyalty_enabled', value: true }))
      expect(res.status).toBe(200)
      expect(mockQuery.mock.calls[0][1]).toEqual(['loyalty_enabled', 'true'])
      expect(mockQuery.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(reconcileLoyaltyUntilDone).mock.invocationCallOrder[0]
      )
      expect((await res.json()).firstPass).toMatchObject({ users: 40, earned: 9645 })
      // ...and only then switches on the tier-upgrade email.
      const enable = mockQuery.mock.calls.findIndex(c => String(c[0]).includes("kind = 'loyalty_tier_upgrade'"))
      expect(enable).toBeGreaterThan(0)
      expect(mockQuery.mock.invocationCallOrder[enable]).toBeGreaterThan(
        vi.mocked(reconcileLoyaltyUntilDone).mock.invocationCallOrder[0]
      )
    })

    it('does not rerun the first pass once launched, nor when Loyalty is switched off', async () => {
      vi.mocked(getLoyaltySettings).mockResolvedValue({ enabled: true, launchedAt: '2026-10-01' } as any)
      expect((await (await PATCH(makeRequest({ key: 'loyalty_enabled', value: 'true' }))).json()).firstPass).toBeNull()
      await PATCH(makeRequest({ updates: [{ key: 'loyalty_enabled', value: 'false' }] }))
      expect(reconcileLoyaltyUntilDone).not.toHaveBeenCalled()
      // An admin who switched the tier email off keeps it off when loyalty is toggled again.
      expect(mockQuery.mock.calls.some(c => String(c[0]).includes('loyalty_tier_upgrade'))).toBe(false)
    })

    it('saves the Birthday rewards switch without needing loyalty', async () => {
      vi.mocked(getLoyaltySettings).mockResolvedValue({ enabled: false } as any)
      expect((await PATCH(makeRequest({ key: 'feature_birthday_enabled', value: 'false' }))).status).toBe(200)
      expect(mockQuery.mock.calls[0][1]).toEqual(['feature_birthday_enabled', 'false'])
    })
  })
})
