import { round2 } from './gst'

export interface DeliverySettings {
  enabled: boolean
  freeThreshold: number
  discountPercent: number
  discountFlat: number
  discountMinSubtotal: number
  discountLabel: string
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
}): ApplyDeliveryResult {
  const { baseCharge, subtotal, settings } = params
  const original = Math.max(0, round2(baseCharge))

  if (!settings.enabled) {
    return { charge: 0, originalCharge: original, discountApplied: original, source: 'admin_disabled' }
  }

  if (settings.freeThreshold > 0 && subtotal >= settings.freeThreshold) {
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
