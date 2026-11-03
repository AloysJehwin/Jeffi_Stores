import { round2 } from '@/lib/catalog/gst'

export interface DeliverySettings {
  enabled: boolean
  freeThreshold: number
  /** Buyer shipping rate in rupees per charged kg. 0 = use the live carrier quote instead. */
  ratePerKg: number
  freeWeightCeilingKg: number
}

export type ApplyDeliverySource = 'admin_disabled' | 'free_threshold' | 'as_is'

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
  weightGrams?: number
  chargedWeightGrams?: number
}): ApplyDeliveryResult {
  const { subtotal, settings } = params
  const weightKg = Math.max(0, (params.weightGrams ?? 0) / 1000)
  const ceiling = settings.freeWeightCeilingKg > 0 ? settings.freeWeightCeilingKg : 3

  if (!settings.enabled) {
    return { charge: 0, originalCharge: 0, discountApplied: 0, source: 'admin_disabled' }
  }

  // Buyer-facing base is the live carrier quote passed in as params.baseCharge. A non-zero
  // ratePerKg replaces that quote with rate x charged weight, where charged weight is the
  // volumetric-vs-actual max the carrier itself bills on — so bulky-but-light parcels are not
  // priced under cost. Falls back to actual weight when no charged weight was supplied.
  const rateWeightKg = Math.max(0, (params.chargedWeightGrams ?? params.weightGrams ?? 0) / 1000)
  const base = settings.ratePerKg > 0 ? settings.ratePerKg * rateWeightKg : Math.max(0, params.baseCharge)
  const original = Math.max(0, round2(base))

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

  return { charge: original, originalCharge: original, discountApplied: 0, source: 'as_is' }
}
