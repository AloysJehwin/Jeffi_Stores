import { describe, it, expect } from 'vitest'
import { applyDeliveryRules, DeliverySettings } from '@/lib/delivery-rules'

// ── Helpers ───────────────────────────────────────────────────────────────────
//
// The buyer-facing charge is the incoming Delhivery/fallback quote (params.baseCharge),
// unless an admin sets a flat settings.baseCharge override. Tests set settings.baseCharge to
// control the "original" charge and pass weightGrams under the ceiling unless testing weight.

function makeSettings(overrides: Partial<DeliverySettings> = {}): DeliverySettings {
  return {
    enabled: true,
    freeThreshold: 0,
    discountPercent: 0,
    discountFlat: 0,
    discountMinSubtotal: 0,
    discountLabel: '',
    baseCharge: 0,
    freeWeightCeilingKg: 3,
    ...overrides,
  }
}

// ── Admin disabled ────────────────────────────────────────────────────────────

describe('applyDeliveryRules — admin_disabled', () => {
  it('returns charge=0 and source=admin_disabled when delivery is disabled', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 500,
      settings: makeSettings({ enabled: false, baseCharge: 100 }),
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('admin_disabled')
  })

  it('returns charge=0 even when subtotal is below free threshold (disabled overrides all)', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 100,
      settings: makeSettings({ enabled: false, freeThreshold: 999, baseCharge: 50 }),
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('admin_disabled')
  })
})

// ── Free threshold ────────────────────────────────────────────────────────────

describe('applyDeliveryRules — free_threshold', () => {
  it('returns charge=0 when subtotal meets free threshold exactly and weight is under ceiling', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 500,
      settings: makeSettings({ freeThreshold: 500, baseCharge: 80 }),
      weightGrams: 1000,
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('free_threshold')
    expect(result.freeThreshold).toBe(500)
    expect(result.discountApplied).toBe(80)
  })

  it('returns charge=0 when subtotal exceeds free threshold', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 1000,
      settings: makeSettings({ freeThreshold: 500, baseCharge: 80 }),
      weightGrams: 500,
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('free_threshold')
  })

  it('does NOT free shipping when weight is at or above the ceiling', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 1000,
      settings: makeSettings({ freeThreshold: 500, baseCharge: 80 }),
      weightGrams: 3000,
    })
    expect(result.charge).not.toBe(0)
    expect(result.source).not.toBe('free_threshold')
  })

  it('does NOT free shipping when subtotal is just below threshold', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 499,
      settings: makeSettings({ freeThreshold: 500, baseCharge: 80 }),
      weightGrams: 500,
    })
    expect(result.charge).not.toBe(0)
    expect(result.source).not.toBe('free_threshold')
  })

  it('does not apply free threshold when freeThreshold is 0', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 9999,
      settings: makeSettings({ freeThreshold: 0, baseCharge: 80 }),
      weightGrams: 500,
    })
    expect(result.source).not.toBe('free_threshold')
  })
})

// ── Weight-based pricing ────────────────────────────────────────────────────────

describe('applyDeliveryRules — weight pricing', () => {
  it('charges flat baseCharge at or under the ceiling', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 60 }),
      weightGrams: 3000,
    })
    expect(result.charge).toBe(60)
    expect(result.source).toBe('as_is')
  })

  it('does not add any surcharge for weight over the ceiling (Delhivery is authoritative)', () => {
    // 4.2kg used to add per-kg surcharge; now the flat baseCharge stands unchanged.
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 60 }),
      weightGrams: 4200,
    })
    expect(result.charge).toBe(60)
    expect(result.originalCharge).toBe(60)
  })

  it('treats missing weight as 0 (flat baseCharge)', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 60 }),
    })
    expect(result.charge).toBe(60)
  })

  it('uses the incoming quote as base when no override is set', () => {
    const result = applyDeliveryRules({
      baseCharge: 85,
      subtotal: 200,
      settings: makeSettings(),
      weightGrams: 4000,
    })
    expect(result.charge).toBe(85)
    expect(result.source).toBe('as_is')
  })
})

// ── As-is (no discount) ───────────────────────────────────────────────────────

describe('applyDeliveryRules — as_is', () => {
  it('returns full charge with source=as_is when no discount configured', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 60 }),
      weightGrams: 500,
    })
    expect(result.charge).toBe(60)
    expect(result.source).toBe('as_is')
    expect(result.discountApplied).toBe(0)
  })

  it('returns as_is when subtotal is below discountMinSubtotal', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 100,
      settings: makeSettings({ baseCharge: 60, discountPercent: 50, discountMinSubtotal: 500 }),
      weightGrams: 500,
    })
    expect(result.source).toBe('as_is')
    expect(result.charge).toBe(60)
  })

  it('returns as_is when baseCharge is 0 even if discounts configured', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 1000,
      settings: makeSettings({ baseCharge: 0, discountPercent: 50 }),
      weightGrams: 500,
    })
    expect(result.source).toBe('as_is')
    expect(result.charge).toBe(0)
  })

  it('rounds computed charge to 2 decimal places in originalCharge', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 100,
      settings: makeSettings({ baseCharge: 49.999 }),
      weightGrams: 500,
    })
    expect(result.originalCharge).toBe(50)
  })
})

// ── Discounted delivery ───────────────────────────────────────────────────────

describe('applyDeliveryRules — discounted', () => {
  it('applies percentage discount to delivery charge', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 100, discountPercent: 50 }),
      weightGrams: 500,
    })
    expect(result.charge).toBe(50)
    expect(result.source).toBe('discounted')
    expect(result.discountApplied).toBe(50)
  })

  it('applies flat discount to delivery charge', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 100, discountFlat: 30 }),
      weightGrams: 500,
    })
    expect(result.charge).toBe(70)
    expect(result.source).toBe('discounted')
    expect(result.discountApplied).toBe(30)
  })

  it('applies both percent and flat discounts sequentially', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 100, discountPercent: 20, discountFlat: 20 }),
      weightGrams: 500,
    })
    expect(result.charge).toBe(60)
    expect(result.source).toBe('discounted')
  })

  it('clamps final charge to 0 if discount exceeds base charge', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 50, discountPercent: 100, discountFlat: 100 }),
      weightGrams: 500,
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('discounted')
  })

  it('includes discountLabel in result when provided', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 300,
      settings: makeSettings({ baseCharge: 100, discountPercent: 25, discountLabel: 'Member discount' }),
      weightGrams: 500,
    })
    expect(result.discountLabel).toBe('Member discount')
  })

  it('does not include discountLabel when label is empty string', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 300,
      settings: makeSettings({ baseCharge: 100, discountPercent: 25, discountLabel: '' }),
      weightGrams: 500,
    })
    expect(result.discountLabel).toBeUndefined()
  })

  it('only applies discount when subtotal meets discountMinSubtotal', () => {
    const settings = makeSettings({ baseCharge: 100, discountPercent: 50, discountMinSubtotal: 300 })

    const belowMin = applyDeliveryRules({ baseCharge: 0, subtotal: 299, settings, weightGrams: 500 })
    expect(belowMin.source).toBe('as_is')
    expect(belowMin.charge).toBe(100)

    const atMin = applyDeliveryRules({ baseCharge: 0, subtotal: 300, settings, weightGrams: 500 })
    expect(atMin.source).toBe('discounted')
    expect(atMin.charge).toBe(50)
  })

  it('rounds final discounted charge to 2 decimal places', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ baseCharge: 99, discountPercent: 33.33 }),
      weightGrams: 500,
    })
    expect(result.charge).toBe(66)
  })
})

// ── Priority ordering ──────────────────────────────────────────────────────────

describe('applyDeliveryRules — rule priority ordering', () => {
  it('admin_disabled takes priority over free threshold', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 9999,
      settings: makeSettings({ enabled: false, freeThreshold: 100, baseCharge: 100 }),
      weightGrams: 500,
    })
    expect(result.source).toBe('admin_disabled')
  })

  it('free_threshold takes priority over discounts', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 600,
      settings: makeSettings({ freeThreshold: 500, discountPercent: 50, baseCharge: 100 }),
      weightGrams: 500,
    })
    expect(result.source).toBe('free_threshold')
    expect(result.charge).toBe(0)
  })
})
