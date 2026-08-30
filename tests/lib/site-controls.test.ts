import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
}))

// The tenant slug arrives on a request header set by middleware, before any query runs.
let mockTenantSlug: string | null = null
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'x-tenant-slug' ? mockTenantSlug : null) }),
}))
vi.mock('@/lib/tenant-context', () => ({ getCurrentTenant: () => null }))

import { getSiteControls, getFeatureFlags, invalidateSiteControlsCache } from '@/lib/site-controls'
import { queryMany } from '@/lib/db'

const mockQueryMany = vi.mocked(queryMany)

// Build a site_settings row set from a plain map of key→value.
function rows(map: Record<string, string>) {
  return Object.entries(map).map(([key, value]) => ({ key, value }))
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateSiteControlsCache()
})

describe('site-controls per-platform on-device flags', () => {
  it('defaults: mobile flags off, desktop mirrors master (empty DB)', async () => {
    mockQueryMany.mockResolvedValueOnce([] as any)
    const flags = await getFeatureFlags()
    // Env unset in test → all default false, but mobile must NEVER default true.
    expect(flags.ondeviceSummaryMobileEnabled).toBe(false)
    expect(flags.ondeviceFinetuneMobileEnabled).toBe(false)
    expect(typeof flags.ondeviceSummaryDesktopEnabled).toBe('boolean')
    expect(typeof flags.ondeviceFinetuneDesktopEnabled).toBe('boolean')
  })

  it('reads each per-platform key from the DB independently', async () => {
    mockQueryMany.mockResolvedValueOnce(rows({
      feature_ondevice_summary_enabled: 'true',
      feature_ondevice_summary_desktop_enabled: 'true',
      feature_ondevice_summary_mobile_enabled: 'false',
      feature_ondevice_finetune_enabled: 'true',
      feature_ondevice_finetune_desktop_enabled: 'true',
      feature_ondevice_finetune_mobile_enabled: 'true',
    }) as any)
    const flags = await getFeatureFlags()
    expect(flags.ondeviceSummaryEnabled).toBe(true)
    expect(flags.ondeviceSummaryDesktopEnabled).toBe(true)
    expect(flags.ondeviceSummaryMobileEnabled).toBe(false)
    expect(flags.ondeviceFinetuneDesktopEnabled).toBe(true)
    expect(flags.ondeviceFinetuneMobileEnabled).toBe(true)
  })

  it('mobile ON while desktop OFF (independent control)', async () => {
    mockQueryMany.mockResolvedValueOnce(rows({
      feature_ondevice_summary_mobile_enabled: 'true',
      feature_ondevice_summary_desktop_enabled: 'false',
    }) as any)
    const flags = await getFeatureFlags()
    expect(flags.ondeviceSummaryMobileEnabled).toBe(true)
    expect(flags.ondeviceSummaryDesktopEnabled).toBe(false)
  })

  it('falls back to DEFAULTS when the DB query throws', async () => {
    mockQueryMany.mockRejectedValueOnce(new Error('db down'))
    const c = await getSiteControls()
    // Never throws; returns defaults with the new fields present.
    expect(c.flags).toHaveProperty('ondeviceSummaryMobileEnabled')
    expect(c.flags.ondeviceSummaryMobileEnabled).toBe(false)
  })
})

/**
 * The cache key used to be read from the AsyncLocalStorage tenant context, which is only
 * established by the request's first database query — and getSiteControls() computes its key
 * BEFORE it queries. So on a tenant host the key was still 'platform', and every tenant shared
 * one entry: a pool box answering a single request without a tenant slug cached the platform's
 * name there, and every tenant storefront then rendered "Jeffi Stores" until the TTL expired.
 */
describe('site-controls tenant isolation', () => {
  beforeEach(() => { mockTenantSlug = null })

  it('does not serve a cached platform identity to a tenant host', async () => {
    // Platform request first — this is what poisoned the shared entry.
    mockQueryMany.mockResolvedValueOnce(rows({ business_name: 'Jeffi Stores' }) as any)
    const platform = await getSiteControls()
    expect(platform.identity.name).toBe('Jeffi Stores')

    // Same process, now a tenant host with nothing configured.
    mockTenantSlug = 'acme'
    mockQueryMany.mockResolvedValueOnce([] as any)
    const tenant = await getSiteControls()
    expect(tenant.identity.name).not.toBe('Jeffi Stores')
    expect(tenant.identity.name).toBe('acme Store')
  })

  it('keeps two tenants apart in the cache', async () => {
    mockTenantSlug = 'alpha'
    mockQueryMany.mockResolvedValueOnce(rows({ business_name: 'Alpha Tools' }) as any)
    expect((await getSiteControls()).identity.name).toBe('Alpha Tools')

    mockTenantSlug = 'beta'
    mockQueryMany.mockResolvedValueOnce(rows({ business_name: 'Beta Supply' }) as any)
    expect((await getSiteControls()).identity.name).toBe('Beta Supply')

    // alpha must still be its own, served from its own cache entry.
    mockTenantSlug = 'alpha'
    expect((await getSiteControls()).identity.name).toBe('Alpha Tools')
  })

  // Showing the platform's support address on a tenant store is worse than showing none.
  it('never falls back to the platform email or phone on a tenant host', async () => {
    mockTenantSlug = 'acme'
    mockQueryMany.mockResolvedValueOnce([] as any)
    const c = await getSiteControls()
    expect(c.identity.email).toBe('')
    expect(c.identity.phone).toBe('')
    expect(c.identity.web).toContain('acme.')
  })

  // A tenant's own configured values must still win over the derived defaults.
  it('prefers the tenant\'s configured identity over the derived name', async () => {
    mockTenantSlug = 'acme'
    mockQueryMany.mockResolvedValueOnce(rows({
      business_name: 'Acme Traders', business_email: 'hi@acme.in',
    }) as any)
    const c = await getSiteControls()
    expect(c.identity.name).toBe('Acme Traders')
    expect(c.identity.email).toBe('hi@acme.in')
  })
})
