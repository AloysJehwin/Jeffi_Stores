import { describe, it, expect } from 'vitest'
import { applyDeliveryRules, DeliverySettings, ApplyDeliveryResult } from '@/lib/delivery-rules'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<DeliverySettings> = {}): DeliverySettings {
  return {
    enabled: true,
    freeThreshold: 0,
    discountPercent: 0,
    discountFlat: 0,
    discountMinSubtotal: 0,
    discountLabel: '',
    ...overrides,
  }
}

// ── Admin disabled ────────────────────────────────────────────────────────────

describe('applyDeliveryRules — admin_disabled', () => {
  it('returns charge=0 and source=admin_disabled when delivery is disabled', () => {
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 500,
      settings: makeSettings({ enabled: false }),
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('admin_disabled')
    expect(result.originalCharge).toBe(100)
    expect(result.discountApplied).toBe(100)
  })

  it('returns charge=0 even when subtotal is below free threshold (disabled overrides all)', () => {
    const result = applyDeliveryRules({
      baseCharge: 50,
      subtotal: 100,
      settings: makeSettings({ enabled: false, freeThreshold: 999 }),
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('admin_disabled')
  })
})

// ── Free threshold ────────────────────────────────────────────────────────────

describe('applyDeliveryRules — free_threshold', () => {
  it('returns charge=0 when subtotal meets free threshold exactly', () => {
    const result = applyDeliveryRules({
      baseCharge: 80,
      subtotal: 500,
      settings: makeSettings({ freeThreshold: 500 }),
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('free_threshold')
    expect(result.freeThreshold).toBe(500)
    expect(result.discountApplied).toBe(80)
  })

  it('returns charge=0 when subtotal exceeds free threshold', () => {
    const result = applyDeliveryRules({
      baseCharge: 80,
      subtotal: 1000,
      settings: makeSettings({ freeThreshold: 500 }),
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('free_threshold')
  })

  it('does NOT free shipping when subtotal is just below threshold', () => {
    const result = applyDeliveryRules({
      baseCharge: 80,
      subtotal: 499,
      settings: makeSettings({ freeThreshold: 500 }),
    })
    expect(result.charge).not.toBe(0)
    expect(result.source).not.toBe('free_threshold')
  })

  it('does not apply free threshold when freeThreshold is 0', () => {
    const result = applyDeliveryRules({
      baseCharge: 80,
      subtotal: 9999,
      settings: makeSettings({ freeThreshold: 0 }),
    })
    expect(result.source).not.toBe('free_threshold')
  })
})

// ── As-is (no discount) ───────────────────────────────────────────────────────

describe('applyDeliveryRules — as_is', () => {
  it('returns full charge with source=as_is when no discount configured', () => {
    const result = applyDeliveryRules({
      baseCharge: 60,
      subtotal: 200,
      settings: makeSettings({ freeThreshold: 0, discountPercent: 0, discountFlat: 0 }),
    })
    expect(result.charge).toBe(60)
    expect(result.source).toBe('as_is')
    expect(result.discountApplied).toBe(0)
  })

  it('returns as_is when subtotal is below discountMinSubtotal', () => {
    const result = applyDeliveryRules({
      baseCharge: 60,
      subtotal: 100,
      settings: makeSettings({ discountPercent: 50, discountMinSubtotal: 500 }),
    })
    expect(result.source).toBe('as_is')
    expect(result.charge).toBe(60)
  })

  it('returns as_is when baseCharge is 0 even if discounts configured', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 1000,
      settings: makeSettings({ discountPercent: 50 }),
    })
    expect(result.source).toBe('as_is')
    expect(result.charge).toBe(0)
  })

  it('rounds baseCharge to 2 decimal places in originalCharge', () => {
    const result = applyDeliveryRules({
      baseCharge: 49.999,
      subtotal: 100,
      settings: makeSettings(),
    })
    expect(result.originalCharge).toBe(50)
  })

  it('clamps negative baseCharge to 0', () => {
    const result = applyDeliveryRules({
      baseCharge: -10,
      subtotal: 100,
      settings: makeSettings(),
    })
    expect(result.originalCharge).toBe(0)
    expect(result.charge).toBe(0)
  })
})

// ── Discounted delivery ───────────────────────────────────────────────────────

describe('applyDeliveryRules — discounted', () => {
  it('applies percentage discount to delivery charge', () => {
    // 100 charge, 50% discount = 50 final
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 200,
      settings: makeSettings({ discountPercent: 50 }),
    })
    expect(result.charge).toBe(50)
    expect(result.source).toBe('discounted')
    expect(result.discountApplied).toBe(50)
  })

  it('applies flat discount to delivery charge', () => {
    // 100 charge, flat 30 off = 70 final
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 200,
      settings: makeSettings({ discountFlat: 30 }),
    })
    expect(result.charge).toBe(70)
    expect(result.source).toBe('discounted')
    expect(result.discountApplied).toBe(30)
  })

  it('applies both percent and flat discounts sequentially', () => {
    // 100 charge, 20% off = 80, then flat 20 off = 60
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 200,
      settings: makeSettings({ discountPercent: 20, discountFlat: 20 }),
    })
    expect(result.charge).toBe(60)
    expect(result.source).toBe('discounted')
  })

  it('clamps final charge to 0 if discount exceeds base charge', () => {
    const result = applyDeliveryRules({
      baseCharge: 50,
      subtotal: 200,
      settings: makeSettings({ discountPercent: 100, discountFlat: 100 }),
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('discounted')
  })

  it('includes discountLabel in result when provided', () => {
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 300,
      settings: makeSettings({ discountPercent: 25, discountLabel: 'Member discount' }),
    })
    expect(result.discountLabel).toBe('Member discount')
  })

  it('does not include discountLabel when label is empty string', () => {
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 300,
      settings: makeSettings({ discountPercent: 25, discountLabel: '' }),
    })
    expect(result.discountLabel).toBeUndefined()
  })

  it('only applies discount when subtotal meets discountMinSubtotal', () => {
    const settings = makeSettings({ discountPercent: 50, discountMinSubtotal: 300 })

    const belowMin = applyDeliveryRules({ baseCharge: 100, subtotal: 299, settings })
    expect(belowMin.source).toBe('as_is')
    expect(belowMin.charge).toBe(100)

    const atMin = applyDeliveryRules({ baseCharge: 100, subtotal: 300, settings })
    expect(atMin.source).toBe('discounted')
    expect(atMin.charge).toBe(50)
  })

  it('rounds final discounted charge to 2 decimal places', () => {
    // 99 charge, 33.33% off = 66.0033 -> 66
    const result = applyDeliveryRules({
      baseCharge: 99,
      subtotal: 200,
      settings: makeSettings({ discountPercent: 33.33 }),
    })
    // afterPercent = 99 * (1 - 0.3333) = 99 * 0.6667 = 66.0033; round2 = 66
    expect(result.charge).toBe(66)
  })
})

// ── Priority ordering ──────────────────────────────────────────────────────────

describe('applyDeliveryRules — rule priority ordering', () => {
  it('admin_disabled takes priority over free threshold', () => {
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 9999,
      settings: makeSettings({ enabled: false, freeThreshold: 100 }),
    })
    expect(result.source).toBe('admin_disabled')
  })

  it('free_threshold takes priority over discounts', () => {
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 600,
      settings: makeSettings({ freeThreshold: 500, discountPercent: 50 }),
    })
    expect(result.source).toBe('free_threshold')
    expect(result.charge).toBe(0)
  })
})
