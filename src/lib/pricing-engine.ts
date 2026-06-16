// Pricing engine for multi-unit selling.
//
// Pure function: given (variant, qty, unit, customer-context), returns the
// price + GST + base-quantity + which rules applied. This is the single
// source of truth for cart, quotation, invoice, and order-creation flows.
//
// Phase 1: schema + framework only. Rule handlers throw 'NOT_IMPLEMENTED'
// for the not-yet-built rule types so the system fails loudly if someone
// configures one early. tiered_price and bonus_qty are the smallest cases
// and are stubbed but functional.

export type RuleType =
  | 'tiered_price'
  | 'gst_threshold'
  | 'bonus_qty'
  | 'bundle_split'
  | 'physical_variance'

export interface ProductUnit {
  id: string
  product_id: string
  variant_id: string
  unit: string
  factor: number
  is_base: boolean
  is_purchase_default: boolean
  is_sell_default: boolean
  display_label: string | null
}

export interface ProductUnitRule {
  id: string
  product_unit_id: string
  rule_type: RuleType
  config: Record<string, unknown>
  is_active: boolean
  priority: number
}

export interface PricingContext {
  variantId: string
  qty: number
  unit: string                       // unit the customer/admin selected
  basePriceExGst: number             // variant's base price ex-GST (per BASE unit)
  baseGstRate: number                // 5/12/18/28
  customer?: {
    type?: 'b2c' | 'b2b'
    userId?: string | null
  }
  units: ProductUnit[]               // all units configured for this variant
  rules: ProductUnitRule[]           // active rules for those units
}

export interface PricingResult {
  unitPrice: number                  // per the selected unit, ex-GST
  unitPriceInclGst: number
  lineTotal: number                  // qty × unitPrice
  lineTotalInclGst: number
  gstRate: number
  baseQuantity: number               // how much BASE-unit stock will be decremented
  selectedUnit: ProductUnit
  baseUnit: ProductUnit
  appliedRules: Array<{ ruleId: string; type: RuleType; effect: string }>
}

export class PricingError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function priceLine(ctx: PricingContext): PricingResult {
  const baseUnit = ctx.units.find(u => u.is_base)
  if (!baseUnit) {
    throw new PricingError('NO_BASE_UNIT', `Variant ${ctx.variantId} has no base unit configured`)
  }
  const selectedUnit = ctx.units.find(u => u.unit === ctx.unit)
  if (!selectedUnit) {
    throw new PricingError('UNKNOWN_UNIT', `Unit '${ctx.unit}' not configured for variant ${ctx.variantId}`)
  }
  if (ctx.qty <= 0) {
    throw new PricingError('BAD_QTY', `Quantity must be positive`)
  }

  // Default unit price: base × factor. Bulk/discount overrides apply via
  // tiered_price rules below.
  let unitPriceExGst = ctx.basePriceExGst * Number(selectedUnit.factor)
  let gstRate = ctx.baseGstRate
  let effectiveFactor = Number(selectedUnit.factor)

  const applied: PricingResult['appliedRules'] = []

  // Walk rules attached to the selected unit, in priority order.
  const rulesForUnit = ctx.rules
    .filter(r => r.product_unit_id === selectedUnit.id && r.is_active)
    .sort((a, b) => a.priority - b.priority)

  for (const rule of rulesForUnit) {
    const result = applyRule(rule, {
      qty: ctx.qty,
      currentUnitPriceExGst: unitPriceExGst,
      currentGstRate: gstRate,
      currentFactor: effectiveFactor,
    })
    if (result.unitPriceExGst !== undefined) unitPriceExGst = result.unitPriceExGst
    if (result.gstRate !== undefined) gstRate = result.gstRate
    if (result.factor !== undefined) effectiveFactor = result.factor
    applied.push({ ruleId: rule.id, type: rule.rule_type, effect: result.effect })
  }

  const unitPrice = round2(unitPriceExGst)
  const unitPriceInclGst = round2(unitPrice * (1 + gstRate / 100))
  const lineTotal = round2(unitPrice * ctx.qty)
  const lineTotalInclGst = round2(unitPriceInclGst * ctx.qty)
  const baseQuantity = ctx.qty * effectiveFactor

  return {
    unitPrice,
    unitPriceInclGst,
    lineTotal,
    lineTotalInclGst,
    gstRate,
    baseQuantity,
    selectedUnit,
    baseUnit,
    appliedRules: applied,
  }
}

interface RuleStepInput {
  qty: number
  currentUnitPriceExGst: number
  currentGstRate: number
  currentFactor: number
}

interface RuleStepOutput {
  unitPriceExGst?: number
  gstRate?: number
  factor?: number
  effect: string
}

function applyRule(rule: ProductUnitRule, step: RuleStepInput): RuleStepOutput {
  switch (rule.rule_type) {
    case 'tiered_price': {
      const tiers = (rule.config.tiers as Array<{ min_qty: number; price: number }>) || []
      const sorted = [...tiers].sort((a, b) => b.min_qty - a.min_qty)
      const match = sorted.find(t => step.qty >= t.min_qty)
      if (match) {
        return { unitPriceExGst: match.price, effect: `tier @ qty≥${match.min_qty}: ₹${match.price}` }
      }
      return { effect: 'no tier matched' }
    }

    case 'bonus_qty': {
      // 'buy 100 get 110' — the customer pays for `buy`, the system delivers
      // `buy + get_extra`. Effective factor multiplies by (buy + get) / buy.
      const buy = Number(rule.config.buy)
      const extra = Number(rule.config.get_extra)
      if (buy > 0 && extra > 0) {
        const newFactor = step.currentFactor * (buy + extra) / buy
        return { factor: newFactor, effect: `bonus +${extra}/${buy}: factor ${step.currentFactor}→${newFactor}` }
      }
      return { effect: 'bonus rule misconfigured' }
    }

    case 'gst_threshold':
    case 'bundle_split':
    case 'physical_variance': {
      throw new PricingError('NOT_IMPLEMENTED', `Rule type ${rule.rule_type} is registered but not implemented yet (Phase 5)`)
    }
  }
}
