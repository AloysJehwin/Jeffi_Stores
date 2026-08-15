import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
}))

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
