import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/delivery-settings', () => ({ invalidateDeliverySettingsCache: vi.fn() }))

import { PATCH } from '@/app/api/admin/settings/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { invalidateDeliverySettingsCache } from '@/lib/delivery-settings'

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
  beforeEach(() => { vi.clearAllMocks() })

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

  it('updates editable key and returns success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makeRequest({ key: 'min_order_amount', value: 500 }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO site_settings'),
      ['min_order_amount', '500']
    )
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
})
