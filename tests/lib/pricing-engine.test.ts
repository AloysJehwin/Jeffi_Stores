import { describe, it, expect } from 'vitest'
import {
  priceLine,
  PricingError,
  PricingContext,
  ProductUnit,
  ProductUnitRule,
} from '@/lib/pricing-engine'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBaseUnit(overrides: Partial<ProductUnit> = {}): ProductUnit {
  return {
    id: 'u-base',
    product_id: 'p1',
    variant_id: 'v1',
    unit: 'pc',
    factor: 1,
    is_base: true,
    is_purchase_default: true,
    is_sell_default: true,
    display_label: 'Piece',
    ...overrides,
  }
}

function makeUnit(overrides: Partial<ProductUnit>): ProductUnit {
  return {
    id: 'u-box',
    product_id: 'p1',
    variant_id: 'v1',
    unit: 'box',
    factor: 12,
    is_base: false,
    is_purchase_default: false,
    is_sell_default: false,
    display_label: 'Box of 12',
    ...overrides,
  }
}

function makeRule(overrides: Partial<ProductUnitRule> & { config: Record<string, unknown> }): ProductUnitRule {
  return {
    id: 'r1',
    product_unit_id: 'u-base',
    rule_type: 'tiered_price',
    is_active: true,
    priority: 1,
    ...overrides,
  }
}

function baseCtx(overrides: Partial<PricingContext> = {}): PricingContext {
  const base = makeBaseUnit()
  return {
    variantId: 'v1',
    qty: 1,
    unit: 'pc',
    basePriceExGst: 100,
    baseGstRate: 18,
    units: [base],
    rules: [],
    ...overrides,
  }
}

// ── Basic pricing ─────────────────────────────────────────────────────────────

describe('priceLine — basic calculations', () => {
  it('computes unit price and line total for base unit qty=1', () => {
    const result = priceLine(baseCtx())
    expect(result.unitPrice).toBe(100)
    expect(result.unitPriceInclGst).toBe(118)
    expect(result.lineTotal).toBe(100)
    expect(result.lineTotalInclGst).toBe(118)
    expect(result.gstRate).toBe(18)
    expect(result.baseQuantity).toBe(1)
  })

  it('scales lineTotal with qty=5', () => {
    const result = priceLine(baseCtx({ qty: 5 }))
    expect(result.lineTotal).toBe(500)
    expect(result.lineTotalInclGst).toBe(590)
    expect(result.baseQuantity).toBe(5)
  })

  it('computes correctly for box unit with factor 12', () => {
    const base = makeBaseUnit()
    const box = makeUnit({ id: 'u-box', unit: 'box', factor: 12 })
    const result = priceLine(baseCtx({
      unit: 'box',
      qty: 2,
      units: [base, box],
    }))
    // unitPrice = 100 * 12 = 1200; lineTotal = 2400; baseQty = 2 * 12 = 24
    expect(result.unitPrice).toBe(1200)
    expect(result.lineTotal).toBe(2400)
    expect(result.baseQuantity).toBe(24)
  })

  it('references correct selectedUnit and baseUnit', () => {
    const base = makeBaseUnit()
    const box = makeUnit({ id: 'u-box', unit: 'box', factor: 12 })
    const result = priceLine(baseCtx({ unit: 'box', units: [base, box] }))
    expect(result.selectedUnit.unit).toBe('box')
    expect(result.baseUnit.unit).toBe('pc')
  })

  it('returns empty appliedRules when no rules present', () => {
    const result = priceLine(baseCtx())
    expect(result.appliedRules).toHaveLength(0)
  })
})

// ── Error conditions ──────────────────────────────────────────────────────────

describe('priceLine — error conditions', () => {
  it('throws NO_BASE_UNIT when no base unit configured', () => {
    const nonBase = makeBaseUnit({ is_base: false })
    expect(() => priceLine(baseCtx({ units: [nonBase] }))).toThrow(PricingError)
    try {
      priceLine(baseCtx({ units: [nonBase] }))
    } catch (e: any) {
      expect(e.code).toBe('NO_BASE_UNIT')
    }
  })

  it('throws UNKNOWN_UNIT when selected unit not in units array', () => {
    expect(() => priceLine(baseCtx({ unit: 'kg' }))).toThrow(PricingError)
    try {
      priceLine(baseCtx({ unit: 'kg' }))
    } catch (e: any) {
      expect(e.code).toBe('UNKNOWN_UNIT')
    }
  })

  it('throws BAD_QTY when qty is 0', () => {
    expect(() => priceLine(baseCtx({ qty: 0 }))).toThrow(PricingError)
    try {
      priceLine(baseCtx({ qty: 0 }))
    } catch (e: any) {
      expect(e.code).toBe('BAD_QTY')
    }
  })

  it('throws BAD_QTY when qty is negative', () => {
    expect(() => priceLine(baseCtx({ qty: -1 }))).toThrow(PricingError)
    try {
      priceLine(baseCtx({ qty: -1 }))
    } catch (e: any) {
      expect(e.code).toBe('BAD_QTY')
    }
  })
})

// ── Tiered pricing rules ───────────────────────────────────────────────────────

describe('priceLine — tiered_price rules', () => {
  it('applies the matching tier when qty meets min_qty', () => {
    const rule = makeRule({
      product_unit_id: 'u-base',
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 10, price: 80 }, { min_qty: 50, price: 60 }] },
    })
    const result = priceLine(baseCtx({ qty: 10, rules: [rule] }))
    expect(result.unitPrice).toBe(80)
    expect(result.appliedRules).toHaveLength(1)
    expect(result.appliedRules[0].type).toBe('tiered_price')
  })

  it('applies the highest qualifying tier (50 unit price when qty=50)', () => {
    const rule = makeRule({
      product_unit_id: 'u-base',
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 10, price: 80 }, { min_qty: 50, price: 60 }] },
    })
    const result = priceLine(baseCtx({ qty: 50, rules: [rule] }))
    expect(result.unitPrice).toBe(60)
  })

  it('does not apply any tier when qty is below all thresholds', () => {
    const rule = makeRule({
      product_unit_id: 'u-base',
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 10, price: 80 }] },
    })
    const result = priceLine(baseCtx({ qty: 5, rules: [rule] }))
    // No tier matched — price stays at base
    expect(result.unitPrice).toBe(100)
    expect(result.appliedRules[0].effect).toBe('no tier matched')
  })

  it('ignores inactive rules', () => {
    const rule = makeRule({
      product_unit_id: 'u-base',
      rule_type: 'tiered_price',
      is_active: false,
      config: { tiers: [{ min_qty: 1, price: 50 }] },
    })
    const result = priceLine(baseCtx({ qty: 5, rules: [rule] }))
    expect(result.unitPrice).toBe(100)
  })

  it('ignores rules for a different product_unit_id', () => {
    const rule = makeRule({
      product_unit_id: 'u-other',
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 1, price: 50 }] },
    })
    const result = priceLine(baseCtx({ qty: 5, rules: [rule] }))
    expect(result.unitPrice).toBe(100)
  })

  it('handles empty tiers array gracefully', () => {
    const rule = makeRule({
      product_unit_id: 'u-base',
      rule_type: 'tiered_price',
      config: { tiers: [] },
    })
    const result = priceLine(baseCtx({ qty: 5, rules: [rule] }))
    expect(result.unitPrice).toBe(100)
  })
})

// ── Bonus qty rules ───────────────────────────────────────────────────────────

describe('priceLine — bonus_qty rules', () => {
  it('adjusts effective factor for buy-N-get-extra offer', () => {
    // buy 100, get extra 10 → factor multiplied by 110/100 = 1.1
    const rule = makeRule({
      product_unit_id: 'u-base',
      rule_type: 'bonus_qty',
      config: { buy: 100, get_extra: 10 },
    })
    const result = priceLine(baseCtx({ qty: 100, rules: [rule] }))
    // baseQuantity = qty * effectiveFactor = 100 * (1 * 1.1) = 110
    expect(result.baseQuantity).toBeCloseTo(110, 5)
    expect(result.appliedRules[0].type).toBe('bonus_qty')
  })

  it('does not change unit price — only factor changes', () => {
    const rule = makeRule({
      product_unit_id: 'u-base',
      rule_type: 'bonus_qty',
      config: { buy: 10, get_extra: 2 },
    })
    const result = priceLine(baseCtx({ qty: 10, rules: [rule] }))
    expect(result.unitPrice).toBe(100)
  })

  it('handles misconfigured bonus rule (buy=0) gracefully', () => {
    const rule = makeRule({
      product_unit_id: 'u-base',
      rule_type: 'bonus_qty',
      config: { buy: 0, get_extra: 10 },
    })
    const result = priceLine(baseCtx({ qty: 10, rules: [rule] }))
    // Factor unchanged, effect says misconfigured
    expect(result.baseQuantity).toBe(10)
    expect(result.appliedRules[0].effect).toContain('misconfigured')
  })
})

// ── Unimplemented rule types ───────────────────────────────────────────────────

describe('priceLine — NOT_IMPLEMENTED rule types', () => {
  it.each(['gst_threshold', 'bundle_split', 'physical_variance'] as const)(
    'throws PricingError for rule type %s',
    (ruleType) => {
      const rule = makeRule({
        product_unit_id: 'u-base',
        rule_type: ruleType,
        config: {},
      })
      expect(() => priceLine(baseCtx({ rules: [rule] }))).toThrow(PricingError)
      try {
        priceLine(baseCtx({ rules: [rule] }))
      } catch (e: any) {
        expect(e.code).toBe('NOT_IMPLEMENTED')
      }
    }
  )
})

// ── Rounding ──────────────────────────────────────────────────────────────────

describe('priceLine — rounding', () => {
  it('rounds unitPrice to 2 decimal places', () => {
    const result = priceLine(baseCtx({ basePriceExGst: 33.333 }))
    expect(result.unitPrice).toBe(33.33)
  })

  it('rounds unitPriceInclGst to 2 decimal places', () => {
    // 33.33 * 1.18 = 39.3294 -> 39.33
    const result = priceLine(baseCtx({ basePriceExGst: 33.333 }))
    expect(result.unitPriceInclGst).toBe(39.33)
  })
})
