import { round2 } from './gst'

export interface DeliverySettings {
  enabled: boolean
  freeThreshold: number
  discountPercent: number
  discountFlat: number
  discountMinSubtotal: number
  discountLabel: string
  baseCharge: number
  perKgOver3: number
  freeWeightCeilingKg: number
}

export type ApplyDeliverySource =
  | 'admin_disabled'
  | 'free_threshold'
  | 'discounted'
  | 'as_is'

export interface ApplyDeliveryResult {
  charge: number
  originalCharge: number
  discountApplied: number
  source: ApplyDeliverySource
  freeThreshold?: number
  discountLabel?: string
}

export function applyDeliveryRules(params: {
  baseCharge: number
  subtotal: number
  settings: DeliverySettings
  weightGrams?: number
}): ApplyDeliveryResult {
  const { subtotal, settings } = params
  const weightKg = Math.max(0, (params.weightGrams ?? 0) / 1000)
  const ceiling = settings.freeWeightCeilingKg > 0 ? settings.freeWeightCeilingKg : 3

  if (!settings.enabled) {
    return { charge: 0, originalCharge: 0, discountApplied: 0, source: 'admin_disabled' }
  }

  // The admin-editable weight formula is the buyer-facing charge — flat up to the ceiling,
  // plus a per-kg surcharge for each whole kg above it — independent of the live Delhivery
  // quote (which is used only for the tenant-cost/wallet side).
  const overKg = Math.max(0, Math.ceil(weightKg - ceiling))
  const original = Math.max(0, round2(settings.baseCharge + overKg * settings.perKgOver3))

  // Free shipping now also requires the parcel to be under the weight ceiling.
  if (settings.freeThreshold > 0 && subtotal >= settings.freeThreshold && weightKg < ceiling) {
    return {
      charge: 0,
      originalCharge: original,
      discountApplied: original,
      source: 'free_threshold',
      freeThreshold: settings.freeThreshold,
    }
  }

  const hasDiscount = (settings.discountPercent > 0 || settings.discountFlat > 0) && original > 0
  const meetsMinSubtotal = settings.discountMinSubtotal <= 0 || subtotal >= settings.discountMinSubtotal

  if (hasDiscount && meetsMinSubtotal) {
    let after = original
    if (settings.discountPercent > 0) after = round2(after * (1 - settings.discountPercent / 100))
    if (settings.discountFlat > 0) after = round2(after - settings.discountFlat)
    after = Math.max(0, after)
    const result: ApplyDeliveryResult = {
      charge: after,
      originalCharge: original,
      discountApplied: round2(original - after),
      source: 'discounted',
    }
    if (settings.discountLabel) result.discountLabel = settings.discountLabel
    return result
  }

  return { charge: original, originalCharge: original, discountApplied: 0, source: 'as_is' }
}
