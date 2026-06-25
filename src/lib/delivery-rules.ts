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

  const discountEligible = subtotal >= (settings.discountMinSubtotal ?? 0)
  const hasDiscount = discountEligible && (settings.discountPercent > 0 || settings.discountFlat > 0)

  if (!hasDiscount || original === 0) {
    return { charge: original, originalCharge: original, discountApplied: 0, source: 'as_is' }
  }

  const afterPercent = original - (original * settings.discountPercent) / 100
  const afterFlat = afterPercent - settings.discountFlat
  const finalCharge = Math.max(0, round2(afterFlat))
  const discountApplied = round2(original - finalCharge)

  return {
    charge: finalCharge,
    originalCharge: original,
    discountApplied,
    source: 'discounted',
    discountLabel: settings.discountLabel || undefined,
  }
}
