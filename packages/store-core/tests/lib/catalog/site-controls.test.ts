import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn().mockResolvedValue([]),
}))

// Static tenancy import — getCurrentTenant. resolveTenantId is pulled via dynamic
// import('@/lib/tenancy/tenant-context'), so it must live on the same mocked module.
vi.mock('@/lib/tenancy/tenant-context', () => ({
  getCurrentTenant: vi.fn(() => null),
  resolveTenantId: vi.fn(async () => null),
}))

vi.mock('@/lib/tenant-registry', () => ({
  lookupTenantContextBySlug: vi.fn(async () => null),
  controlPlanePool: vi.fn(() => ({ query: vi.fn(async () => ({ rows: [{ own_delhivery: true }] })) })),
}))

vi.mock('@/lib/auth/plan-gate', () => ({
  getTenantPlan: vi.fn(async () => ({ scopes: new Set(['inventory:read', 'campaigns:read']) })),
}))

vi.mock('@/lib/billing/messaging-addon', () => ({
  messagingEntitlement: vi.fn(async () => ({ sms: 'ok', whatsapp: 'ok' })),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

import {
  getSiteControls,
  getFeatureFlags,
  getStoreIdentity,
  getBusinessValues,
  getStorefrontContent,
  invalidateSiteControlsCache,
  SITE_CONTROLS_DEFAULTS,
  FLAGSHIP_APP_BUILD_ID,
} from '@/lib/catalog/site-controls'
import { queryMany } from '@/lib/shared/db'
import { getCurrentTenant, resolveTenantId } from '@/lib/tenancy/tenant-context'
import { controlPlanePool, lookupTenantContextBySlug } from '@/lib/tenant-registry'
import { getTenantPlan } from '@/lib/auth/plan-gate'
import { messagingEntitlement } from '@/lib/billing/messaging-addon'
import { headers } from 'next/headers'

function rows(obj: Record<string, string>) {
  return Object.entries(obj).map(([key, value]) => ({ key, value }))
}

beforeEach(() => {
  vi.mocked(queryMany).mockReset().mockResolvedValue([] as any)
  vi.mocked(getCurrentTenant).mockReset().mockReturnValue(null as any)
  vi.mocked(resolveTenantId).mockReset().mockResolvedValue(null as any)
  vi.mocked(controlPlanePool).mockReset().mockReturnValue({
    query: vi.fn(async () => ({ rows: [{ own_delhivery: true }] })),
  } as any)
  vi.mocked(lookupTenantContextBySlug).mockReset().mockResolvedValue(null as any)
  vi.mocked(getTenantPlan).mockReset().mockResolvedValue({
    scopes: new Set(['inventory:read', 'campaigns:read']),
  } as any)
  vi.mocked(messagingEntitlement).mockReset().mockResolvedValue({ sms: 'ok', whatsapp: 'ok' } as any)
  vi.mocked(headers).mockReset().mockResolvedValue(new Headers() as any)
  // invalidate with no tenant in scope clears everything
  invalidateSiteControlsCache()
})

afterEach(() => invalidateSiteControlsCache())

describe('platform defaults (no tenant, empty settings)', () => {
  it('returns the platform identity and default flags', async () => {
    const c = await getSiteControls()
    expect(c.identity.name).toBe('Jeffi Stores')
    expect(c.mobileApp.buildId).toBe(FLAGSHIP_APP_BUILD_ID)
    expect(c.ownDelhivery).toBe(true)
    expect(c.flags.codEnabled).toBe(true)
    // keeps the flagship storefront copy (not tenant-scoped)
    expect(c.storefront.metaTagline).toBe(SITE_CONTROLS_DEFAULTS.storefront.metaTagline)
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).toContain('FROM site_settings WHERE key = ANY($1::text[])')
    expect(Array.isArray(params![0])).toBe(true)
  })

  it('caches within the TTL — a second call does not re-query', async () => {
    await getSiteControls()
    await getSiteControls()
    expect(vi.mocked(queryMany)).toHaveBeenCalledTimes(1)
  })

  it('invalidate forces a re-read', async () => {
    await getSiteControls()
    invalidateSiteControlsCache()
    await getSiteControls()
    expect(vi.mocked(queryMany)).toHaveBeenCalledTimes(2)
  })
})

describe('setting parsing', () => {
  it('string/num/bool overrides apply with clamping', async () => {
    vi.mocked(queryMany).mockResolvedValue(
      rows({
        business_name: 'Acme',
        feature_cod_enabled: 'false',
        feature_gst_enabled: 'TRUE',
        cod_surcharge_flat: '-5', // clamped to 0
        order_auto_cancel_minutes: '0', // clamped up to 1
        storefront_featured_limit: '3.7', // rounded
      }) as any
    )
    const c = await getSiteControls()
    expect(c.identity.name).toBe('Acme')
    expect(c.flags.codEnabled).toBe(false)
    expect(c.flags.gstEnabled).toBe(true)
    expect(c.values.codSurchargeFlat).toBe(0)
    expect(c.values.orderAutoCancelMinutes).toBe(1)
    expect(c.storefront.featuredLimit).toBe(4)
  })

  it('blank and invalid numeric values fall back to defaults', async () => {
    vi.mocked(queryMany).mockResolvedValue(
      rows({ business_name: '', cod_surcharge_pct: 'not-a-number' }) as any
    )
    const c = await getSiteControls()
    expect(c.identity.name).toBe('Jeffi Stores') // blank -> default
    expect(c.values.codSurchargePct).toBe(SITE_CONTROLS_DEFAULTS.values.codSurchargePct)
  })

  it('favicon falls back to the logo url when unset', async () => {
    vi.mocked(queryMany).mockResolvedValue(rows({ business_logo_url: 'http://x/logo.png' }) as any)
    const c = await getSiteControls()
    expect(c.identity.faviconUrl).toBe('http://x/logo.png')
  })

  it('provider strings only accept "aws", else twilio', async () => {
    vi.mocked(queryMany).mockResolvedValue(
      rows({ feature_sms_provider: 'aws', feature_whatsapp_provider: 'garbage' }) as any
    )
    const c = await getSiteControls()
    expect(c.flags.smsProvider).toBe('aws')
    expect(c.flags.whatsappProvider).toBe('twilio')
  })

  it('an explicit empty mobile_app_build_id clears the app and forces push off', async () => {
    vi.mocked(queryMany).mockResolvedValue(rows({ mobile_app_build_id: '   ' }) as any)
    const c = await getSiteControls()
    expect(c.mobileApp.buildId).toBeNull()
    expect(c.flags.pushEnabled).toBe(false)
    expect(c.flags.marketingPushEnabled).toBe(false)
    expect(c.locks.push).toBe('app')
  })
})

describe('tenant scoping', () => {
  beforeEach(() => {
    vi.mocked(getCurrentTenant).mockReturnValue({
      tenantId: 't1',
      slug: 'acme',
      displayName: 'Acme Store',
    } as any)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
  })

  it('uses the tenant record for identity and drops flagship storefront copy', async () => {
    const c = await getSiteControls()
    expect(c.identity.name).toBe('Acme Store')
    expect(c.identity.email).toBe('') // never inherit platform contact
    expect(c.storefront.metaTagline).toBe('') // tenant-scoped default is empty
    expect(c.mobileApp.buildId).toBeNull() // tenant has no app by default
  })

  it('falls back to "<slug> Store" when the tenant record has no display name', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ tenantId: 't1', slug: 'acme', displayName: '' } as any)
    const c = await getSiteControls()
    expect(c.identity.name).toBe('acme Store')
  })

  it('recovers the display name via slug lookup when ALS has none', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue(null as any)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
    vi.mocked(headers).mockResolvedValue(new Headers({ 'x-tenant-slug': 'acme' }) as any)
    vi.mocked(lookupTenantContextBySlug).mockResolvedValue({ displayName: 'Looked Up' } as any)
    const c = await getSiteControls()
    expect(c.identity.name).toBe('Looked Up')
  })

  it('forces COD off when the tenant is not on its own Delhivery', async () => {
    vi.mocked(controlPlanePool).mockReturnValue({
      query: vi.fn(async () => ({ rows: [{ own_delhivery: false }] })),
    } as any)
    const c = await getSiteControls()
    expect(c.ownDelhivery).toBe(false)
    expect(c.flags.codEnabled).toBe(false)
  })

  it('plan gate strips inventory and birthday when scopes are missing', async () => {
    vi.mocked(getTenantPlan).mockResolvedValue({ scopes: new Set<string>() } as any)
    const c = await getSiteControls()
    expect(c.flags.inventoryValidationEnabled).toBe(false)
    expect(c.flags.birthdayEnabled).toBe(false)
  })

  it('messaging entitlement locks set the lock reason and force the channel off', async () => {
    vi.mocked(messagingEntitlement).mockResolvedValue({ sms: 'addon', whatsapp: 'number' } as any)
    const c = await getSiteControls()
    expect(c.flags.smsEnabled).toBe(false)
    expect(c.flags.whatsappEnabled).toBe(false)
    expect(c.locks.sms).toBe('addon')
    expect(c.locks.whatsapp).toBe('number')
  })
})

describe('failure paths', () => {
  it('a control-plane hiccup fails COD closed (ownDelhivery false)', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ tenantId: 't1', slug: 'acme', displayName: 'Acme' } as any)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
    vi.mocked(controlPlanePool).mockReturnValue({
      query: vi.fn(async () => {
        throw new Error('cp down')
      }),
    } as any)
    const c = await getSiteControls()
    expect(c.ownDelhivery).toBe(false)
    expect(c.flags.codEnabled).toBe(false)
  })

  it('a thrown settings query returns platform defaults when no tenant in scope', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db down'))
    const c = await getSiteControls()
    expect(c.identity.name).toBe('Jeffi Stores')
    expect(c.locks).toEqual({})
  })

  it('a thrown settings query on a tenant host returns a safe app-off shell', async () => {
    vi.mocked(getCurrentTenant).mockReturnValue({ tenantId: 't1', slug: 'acme', displayName: 'Acme' } as any)
    vi.mocked(queryMany).mockRejectedValue(new Error('db down'))
    const c = await getSiteControls()
    expect(c.identity.name).toBe('Acme')
    expect(c.mobileApp.buildId).toBeNull()
    expect(c.flags.pushEnabled).toBe(false)
    expect(c.locks).toEqual({ push: 'app' })
  })
})

describe('focused getters', () => {
  it('delegate to getSiteControls', async () => {
    vi.mocked(queryMany).mockResolvedValue(rows({ business_name: 'Acme' }) as any)
    expect((await getStoreIdentity()).name).toBe('Acme')
    expect((await getFeatureFlags()).codEnabled).toBe(true)
    expect(typeof (await getBusinessValues()).codSurchargeFlat).toBe('number')
    expect(typeof (await getStorefrontContent()).featuredLimit).toBe('number')
  })
})
