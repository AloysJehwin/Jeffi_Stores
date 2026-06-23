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
    { key: 'delivery_discount_percent', value: '10' },
    { key: 'delivery_discount_flat', value: '50' },
    { key: 'delivery_discount_min_subtotal', value: '200' },
    { key: 'delivery_discount_label', value: 'Save on delivery' },
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
    expect(s.discountPercent).toBe(10)
    expect(s.discountFlat).toBe(50)
    expect(s.discountMinSubtotal).toBe(200)
    expect(s.discountLabel).toBe('Save on delivery')
  })

  it('parses enabled=false when row value is "false"', async () => {
    mockQueryMany.mockResolvedValue(
      makeRows({ delivery_charges_enabled: 'false' })
    )
    const s = await getDeliverySettings()
    expect(s.enabled).toBe(false)
  })

  it('clamps discountPercent to [0,100]', async () => {
    mockQueryMany.mockResolvedValue(
      makeRows({ delivery_discount_percent: '150' })
    )
    const s = await getDeliverySettings()
    expect(s.discountPercent).toBe(100)
  })

  it('floors negative freeThreshold to 0', async () => {
    mockQueryMany.mockResolvedValue(
      makeRows({ delivery_free_threshold: '-100' })
    )
    const s = await getDeliverySettings()
    expect(s.freeThreshold).toBe(0)
  })

  it('falls back to DEFAULTS on DB error', async () => {
    mockQueryMany.mockRejectedValue(new Error('db error'))
    const s = await getDeliverySettings()
    expect(s.enabled).toBe(true)
    expect(s.freeThreshold).toBe(0)
    expect(s.discountPercent).toBe(0)
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
    expect(s.discountPercent).toBe(0)
  })

  it('trims whitespace from discountLabel', async () => {
    mockQueryMany.mockResolvedValue(
      makeRows({ delivery_discount_label: '  Free shipping  ' })
    )
    const s = await getDeliverySettings()
    expect(s.discountLabel).toBe('Free shipping')
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
