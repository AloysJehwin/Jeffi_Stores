import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { getDeliverySettings, invalidateDeliverySettingsCache } from '@/lib/delivery-settings'
import { queryMany } from '@/lib/db'

const mockQueryMany = vi.mocked(queryMany)

function makeRows(overrides: Record<string, string> = {}) {
  const defaults: Array<{ key: string; value: string }> = [
    { key: 'delivery_charges_enabled', value: 'true' },
    { key: 'delivery_free_threshold', value: '500' },
    { key: 'delivery_rate_per_kg', value: '60' },
    { key: 'delivery_free_weight_ceiling_kg', value: '3' },
  ]
  return defaults.map(r => ({ key: r.key, value: (overrides as any)[r.key] ?? r.value }))
}

describe('getDeliverySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateDeliverySettingsCache()
  })

  it('parses all settings from DB rows', async () => {
    mockQueryMany.mockResolvedValue(makeRows())
    const s = await getDeliverySettings()
    expect(s.enabled).toBe(true)
    expect(s.freeThreshold).toBe(500)
  })

  it('parses weight-pricing keys and defaults the ceiling to 3', async () => {
    mockQueryMany.mockResolvedValue(makeRows())
    const s = await getDeliverySettings()
    expect(s.ratePerKg).toBe(60)
    expect(s.freeWeightCeilingKg).toBe(3)
  })

  it('defaults freeWeightCeilingKg to 3 when the row is absent', async () => {
    mockQueryMany.mockResolvedValue([])
    const s = await getDeliverySettings()
    expect(s.freeWeightCeilingKg).toBe(3)
    expect(s.ratePerKg).toBe(0)
  })

  it('parses enabled=false when row value is "false"', async () => {
    mockQueryMany.mockResolvedValue(makeRows({ delivery_charges_enabled: 'false' }))
    const s = await getDeliverySettings()
    expect(s.enabled).toBe(false)
  })

  it('floors negative ratePerKg to 0', async () => {
    mockQueryMany.mockResolvedValue(makeRows({ delivery_rate_per_kg: '-10' }))
    const s = await getDeliverySettings()
    expect(s.ratePerKg).toBe(0)
  })

  it('floors negative freeThreshold to 0', async () => {
    mockQueryMany.mockResolvedValue(makeRows({ delivery_free_threshold: '-100' }))
    const s = await getDeliverySettings()
    expect(s.freeThreshold).toBe(0)
  })

  it('falls back to DEFAULTS on DB error', async () => {
    mockQueryMany.mockRejectedValue(new Error('db error'))
    const s = await getDeliverySettings()
    expect(s.enabled).toBe(true)
    expect(s.freeThreshold).toBe(0)
    expect(s.ratePerKg).toBe(0)
  })

  it('returns cached value on second call without re-querying', async () => {
    mockQueryMany.mockResolvedValue(makeRows())
    await getDeliverySettings()
    await getDeliverySettings()
    expect(mockQueryMany).toHaveBeenCalledOnce()
  })

  it('re-queries after cache is invalidated', async () => {
    mockQueryMany.mockResolvedValue(makeRows())
    await getDeliverySettings()
    invalidateDeliverySettingsCache()
    await getDeliverySettings()
    expect(mockQueryMany).toHaveBeenCalledTimes(2)
  })

  it('handles empty rows by using DEFAULTS for each field', async () => {
    mockQueryMany.mockResolvedValue([])
    const s = await getDeliverySettings()
    expect(s.enabled).toBe(true)
    expect(s.freeThreshold).toBe(0)
    expect(s.ratePerKg).toBe(0)
  })
})

describe('invalidateDeliverySettingsCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateDeliverySettingsCache()
  })

  it('clears the cache so next call queries DB again', async () => {
    mockQueryMany.mockResolvedValue(makeRows())
    await getDeliverySettings()
    invalidateDeliverySettingsCache()
    await getDeliverySettings()
    expect(mockQueryMany).toHaveBeenCalledTimes(2)
  })
})
