import { round2 } from './gst'

export interface DeliverySettings {
  enabled: boolean
  freeThreshold: number
}

export type ApplyDeliverySource =
  | 'admin_disabled'
  | 'free_threshold'
  | 'as_is'

export interface ApplyDeliveryResult {
  charge: number
  originalCharge: number
  discountApplied: number
  source: ApplyDeliverySource
  freeThreshold?: number
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

  return { charge: original, originalCharge: original, discountApplied: 0, source: 'as_is' }
}
