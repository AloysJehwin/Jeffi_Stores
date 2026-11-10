import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => [{ key: 'feature_sms_enabled', value: 'true' }, { key: 'feature_whatsapp_enabled', value: 'true' }]) }))
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
let tenantId: string | null = 't-1'
vi.mock('@/lib/tenancy/tenant-context', () => ({
  getCurrentTenant: () => (tenantId ? { tenantId, slug: 'acme', displayName: 'Acme' } : null),
  resolveTenantId: async () => tenantId,
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: async () => ({ rows: [{ own_delhivery: true }] }) }) }))
vi.mock('@/lib/auth/plan-gate', () => ({ getTenantPlan: async () => ({ scopes: new Set(['inventory:read', 'campaigns:read']) }) }))
const messagingEntitlement = vi.fn()
vi.mock('@/lib/billing/messaging-addon', () => ({ messagingEntitlement: (...a: unknown[]) => messagingEntitlement(...a) }))

import { getSiteControls, invalidateSiteControlsCache } from '@/lib/catalog/site-controls'

beforeEach(() => {
  tenantId = 't-1'
  invalidateSiteControlsCache()
  messagingEntitlement.mockReset()
})

describe('site-controls SMS & WhatsApp add-on locks', () => {
  it('forces a locked channel off and says why', async () => {
    messagingEntitlement.mockResolvedValue({ sms: 'addon', whatsapp: 'number' })
    const c = await getSiteControls()
    expect(c.flags.smsEnabled).toBe(false)
    expect(c.flags.whatsappEnabled).toBe(false)
    expect(c.locks).toEqual({ sms: 'addon', whatsapp: 'number', push: 'app' })
  })

  it('leaves an entitled channel on the stored switch', async () => {
    messagingEntitlement.mockResolvedValue({ sms: 'ok', whatsapp: 'addon' })
    const c = await getSiteControls()
    expect(c.flags.smsEnabled).toBe(true)
    expect(c.flags.whatsappEnabled).toBe(false)
    expect(c.locks).toEqual({ whatsapp: 'addon', push: 'app' })
  })

  it('never locks the flagship', async () => {
    tenantId = null
    const c = await getSiteControls()
    expect(c.locks).toEqual({})
    expect(c.flags.smsEnabled).toBe(true)
    expect(messagingEntitlement).not.toHaveBeenCalled()
  })
})
