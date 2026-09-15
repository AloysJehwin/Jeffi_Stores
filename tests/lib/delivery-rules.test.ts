import { describe, it, expect } from 'vitest'
import { applyDeliveryRules, DeliverySettings } from '@/lib/delivery-rules'

// ── Helpers ───────────────────────────────────────────────────────────────────
//
// The buyer-facing charge is the incoming Delhivery/fallback quote (params.baseCharge),
// unless an admin sets settings.ratePerKg, which prices it as rate x charged weight instead.
// Tests pass params.baseCharge to stand in for the carrier quote and pass weightGrams under
// the ceiling unless testing weight.

function makeSettings(overrides: Partial<DeliverySettings> = {}): DeliverySettings {
  return {
    enabled: true,
    freeThreshold: 0,
    ratePerKg: 0,
    freeWeightCeilingKg: 3,
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
  it('returns charge=0 when subtotal meets free threshold exactly and weight is under ceiling', () => {
    const result = applyDeliveryRules({
      baseCharge: 80,
      subtotal: 500,
      settings: makeSettings({ freeThreshold: 500 }),
      weightGrams: 1000,
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
      weightGrams: 500,
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('free_threshold')
  })

  it('does NOT free shipping when weight is at or above the ceiling', () => {
    const result = applyDeliveryRules({
      baseCharge: 80,
      subtotal: 1000,
      settings: makeSettings({ freeThreshold: 500 }),
      weightGrams: 3000,
    })
    expect(result.charge).not.toBe(0)
    expect(result.source).not.toBe('free_threshold')
  })

  it('does NOT free shipping when subtotal is just below threshold', () => {
    const result = applyDeliveryRules({
      baseCharge: 80,
      subtotal: 499,
      settings: makeSettings({ freeThreshold: 500 }),
      weightGrams: 500,
    })
    expect(result.charge).not.toBe(0)
    expect(result.source).not.toBe('free_threshold')
  })

  it('does not apply free threshold when freeThreshold is 0', () => {
    const result = applyDeliveryRules({
      baseCharge: 80,
      subtotal: 9999,
      settings: makeSettings({ freeThreshold: 0 }),
      weightGrams: 500,
    })
    expect(result.source).not.toBe('free_threshold')
  })
})

// ── Weight-based pricing ────────────────────────────────────────────────────────

describe('applyDeliveryRules — ratePerKg', () => {
  it('uses the incoming carrier quote when ratePerKg is 0', () => {
    const result = applyDeliveryRules({
      baseCharge: 85,
      subtotal: 200,
      settings: makeSettings({ ratePerKg: 0 }),
      weightGrams: 4000,
      chargedWeightGrams: 4000,
    })
    expect(result.charge).toBe(85)
    expect(result.source).toBe('as_is')
  })

  it('replaces the carrier quote with rate x charged weight when ratePerKg is set', () => {
    const result = applyDeliveryRules({
      baseCharge: 9999,
      subtotal: 200,
      settings: makeSettings({ ratePerKg: 50 }),
      weightGrams: 5000,
      chargedWeightGrams: 12000,
    })
    expect(result.charge).toBe(600)
    expect(result.source).toBe('as_is')
  })

  it('prices on charged (volumetric) weight, not actual weight', () => {
    const actual = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ ratePerKg: 50 }),
      weightGrams: 5000,
      chargedWeightGrams: 5000,
    })
    const volumetric = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ ratePerKg: 50 }),
      weightGrams: 5000,
      chargedWeightGrams: 12000,
    })
    expect(actual.charge).toBe(250)
    expect(volumetric.charge).toBe(600)
  })

  it('applies the rate to the full weight with no ceiling qualifier', () => {
    const underCeiling = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 100,
      settings: makeSettings({ ratePerKg: 50 }),
      chargedWeightGrams: 2000,
    })
    const overCeiling = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 100,
      settings: makeSettings({ ratePerKg: 50 }),
      chargedWeightGrams: 4000,
    })
    expect(underCeiling.charge).toBe(100)
    expect(overCeiling.charge).toBe(200)
  })

  it('falls back to actual weight when no charged weight is supplied', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 200,
      settings: makeSettings({ ratePerKg: 50 }),
      weightGrams: 3000,
    })
    expect(result.charge).toBe(150)
  })

  it('charges 0 when ratePerKg is set but the shipment has no weight', () => {
    const result = applyDeliveryRules({
      baseCharge: 500,
      subtotal: 200,
      settings: makeSettings({ ratePerKg: 50 }),
    })
    expect(result.charge).toBe(0)
  })

  it('still frees a rate-derived charge at the free threshold under the ceiling', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 500,
      settings: makeSettings({ ratePerKg: 50, freeThreshold: 500 }),
      weightGrams: 1000,
      chargedWeightGrams: 1000,
    })
    expect(result.charge).toBe(0)
    expect(result.source).toBe('free_threshold')
    expect(result.discountApplied).toBe(50)
  })
})

// ── As-is ─────────────────────────────────────────────────────────────────────

describe('applyDeliveryRules — as_is', () => {
  it('returns the full carrier quote with source=as_is', () => {
    const result = applyDeliveryRules({
      baseCharge: 60,
      subtotal: 200,
      settings: makeSettings(),
      weightGrams: 500,
    })
    expect(result.charge).toBe(60)
    expect(result.source).toBe('as_is')
    expect(result.discountApplied).toBe(0)
  })

  it('returns charge 0 when the carrier quote is 0', () => {
    const result = applyDeliveryRules({
      baseCharge: 0,
      subtotal: 1000,
      settings: makeSettings(),
      weightGrams: 500,
    })
    expect(result.source).toBe('as_is')
    expect(result.charge).toBe(0)
  })

  it('rounds computed charge to 2 decimal places in originalCharge', () => {
    const result = applyDeliveryRules({
      baseCharge: 49.999,
      subtotal: 100,
      settings: makeSettings(),
      weightGrams: 500,
    })
    expect(result.originalCharge).toBe(50)
  })
})

// ── Priority ordering ──────────────────────────────────────────────────────────

describe('applyDeliveryRules — rule priority ordering', () => {
  it('admin_disabled takes priority over free threshold', () => {
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 9999,
      settings: makeSettings({ enabled: false, freeThreshold: 100 }),
      weightGrams: 500,
    })
    expect(result.source).toBe('admin_disabled')
  })

  it('free_threshold takes priority over a per-kg rate', () => {
    const result = applyDeliveryRules({
      baseCharge: 100,
      subtotal: 600,
      settings: makeSettings({ freeThreshold: 500, ratePerKg: 50 }),
      weightGrams: 500,
      chargedWeightGrams: 500,
    })
    expect(result.source).toBe('free_threshold')
    expect(result.charge).toBe(0)
  })
})
