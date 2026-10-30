import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockRequireAdminScope, mockResolveTenant, mockSyncMerchant } = vi.hoisted(() => ({
  mockRequireAdminScope: vi.fn(),
  mockResolveTenant: vi.fn(),
  mockSyncMerchant: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: mockRequireAdminScope }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: mockResolveTenant }))
vi.mock('@/lib/merchant/sync', () => ({ syncAllProductsToMerchant: mockSyncMerchant }))
vi.mock('@/lib/amazon/sync', () => ({ syncAllProductsToAmazon: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/integrations/sync/route'

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/integrations/sync', { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/admin/integrations/sync (google_merchant)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdminScope.mockResolvedValue({ adminId: 'a1' })
    mockResolveTenant.mockResolvedValue({ tenantId: 't1', slug: 'acme' })
  })

  it('runs the Merchant API sync in the tenant context and returns its result', async () => {
    const result = { synced: 3, deleted: 0, errors: [], startedAt: 's', finishedAt: 'f' }
    mockSyncMerchant.mockResolvedValue(result)
    const res = await POST(req({ provider: 'google_merchant' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, provider: 'google_merchant', result })
  })

  it('returns 409 while a sync is already running', async () => {
    const err = Object.assign(new Error('A Google Merchant sync is already running.'), {
      name: 'MerchantSyncInProgressError',
    })
    mockSyncMerchant.mockRejectedValue(err)
    const res = await POST(req({ provider: 'google_merchant' }))
    expect(res.status).toBe(409)
    expect((await res.json()).inProgress).toBe(true)
  })

  it('syncs for the flagship too (its creds come from its own connection, else env)', async () => {
    mockResolveTenant.mockResolvedValue(null)
    await POST(req({ provider: 'google_merchant' }))
    expect(mockSyncMerchant).toHaveBeenCalled()
  })

  it('passes through an auth failure', async () => {
    mockRequireAdminScope.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req({ provider: 'google_merchant' }))).status).toBe(403)
  })
})
