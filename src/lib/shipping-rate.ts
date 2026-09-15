import { queryMany } from '@/lib/db'
import { round2 } from '@/lib/gst'
import {
  packIntoCartons,
  fallbackShippingRate,
  ShipmentItem,
  PackageType,
  CARTON_MAX_WEIGHT_GRAMS,
} from '@/lib/shipping'
import { getDeliverySettings, applyDeliveryRules } from '@/lib/delivery-settings'
import { getBusinessValues, type BusinessValues } from '@/lib/site-controls'
import { getCurrentTenantId, resolveTenantId } from '@/lib/tenant-context'
import { listDelhiveryPickupLocations, checkPincodeServiceability } from '@/lib/delhivery'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'

const DELHIVERY_API = 'https://track.delhivery.com/api/kinko/v1/invoice/charges/.json'

export interface RateBreakdown {
  charge: number
  codFee: number
  totalCharge: number
  zone: string
  source: 'delhivery' | 'fallback' | 'rate_per_kg' | 'free' | 'admin_disabled' | 'free_threshold' | 'unserviceable'
  chargedWeightGrams: number
  cartonCount: number
  cartons?: { weightGrams: number; charge: number; zone: string }[]
  freeShippingThreshold?: number
  // Delhivery pincode serviceability for the destination. serviceable=false means the
  // carrier does not deliver here at all — checkout must block, never quote a charge.
  serviceable: boolean
  serviceCod?: boolean
  servicePrepaid?: boolean
  serviceError?: string
}

export interface RateInput {
  destinationPin: string
  cartItems: Array<{ productId?: string; variantId?: string | null; subVariantId?: string | null; quantity?: number }>
  subtotal?: number
  isCod?: boolean
}

// Ship-from pincode is the tenant's default pickup warehouse pin; fall back to the
// configured origin pincode (env-defaulted) when no warehouse matches.
async function resolveOriginPin(defaultOriginPin: string, pickupLocationName: string): Promise<string> {
  const tenantId = await resolveTenantId()
  const locations = await listDelhiveryPickupLocations(tenantId ?? undefined).catch(() => [])
  const match = locations.find(l => l.name === pickupLocationName) ?? locations[0]
  return match?.pin || defaultOriginPin
}

async function callDelhiveryForCarton(
  carton: { chargedWeightGrams: number; actualWeightGrams?: number; length_cm?: number; breadth_cm?: number; height_cm?: number },
  destinationPin: string,
  isCod: boolean,
  originPin: string,
  token: string,
) {
  const cgmGrams = Number(carton.actualWeightGrams) > 0
    ? Number(carton.actualWeightGrams)
    : carton.chargedWeightGrams
  const params = new URLSearchParams({
    md: 'S',
    ss: 'Delivered',
    d_pin: destinationPin,
    o_pin: originPin,
    cgm: String(Math.max(1, Math.round(cgmGrams))),
    pt: isCod ? 'COD' : 'Pre-paid',
    cod: '0',
  })
  // Dimensions are optional per the invoice-charges spec. Send them when known so Delhivery
  // applies its own volumetric divisor rather than relying on our pre-collapsed weight.
  const dims: Array<[string, number | undefined]> = [
    ['l', carton.length_cm], ['b', carton.breadth_cm], ['h', carton.height_cm],
  ]
  for (const [key, val] of dims) {
    if (Number(val) > 0) params.set(key, String(Math.round(Number(val))))
  }
  const res = await fetch(`${DELHIVERY_API}?${params}`, {
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Delhivery ${res.status}`)
  const data = await res.json()
  const rate = Array.isArray(data) ? data[0] : data
  if (!rate || rate.error || rate.total_amount == null) throw new Error(rate?.error || 'no rate')
  return {
    charge: Number(rate.total_amount),
    zone: String(rate.zone || ''),
    chargedWeight: Number(rate.charged_weight) || carton.chargedWeightGrams,
  }
}

// A product/variant's shipping weight. Missing/0/NaN -> defaultProductWeightG; a real but very
// low weight (<= 50g) -> defaultWeightG, so under-weighed items price against a realistic parcel.
function resolveShipWeight(raw: unknown, bv: BusinessValues): number {
  const w = parseFloat(String(raw))
  if (!Number.isFinite(w) || w <= 0) return bv.defaultProductWeightG
  if (w <= 50) return bv.defaultWeightG
  return w
}

export async function computeShippingRate(input: RateInput): Promise<RateBreakdown> {
  const { destinationPin, cartItems, subtotal, isCod } = input
  const TOKEN = await resolveDelhiveryToken()
  const bv = await getBusinessValues()
  const originPin = await resolveOriginPin(bv.delhiveryOriginPincode, bv.pickupLocation)

  const subVariantIds: string[] = (cartItems || []).filter(i => i.subVariantId).map(i => i.subVariantId as string)
  const variantIds: string[] = (cartItems || []).filter(i => i.variantId && !i.subVariantId).map(i => i.variantId as string)
  const productIds: string[] = (cartItems || []).filter(i => !i.variantId && !i.subVariantId).map(i => i.productId as string)

  const shipmentItems: ShipmentItem[] = []

  if (subVariantIds.length > 0) {
    const subVariants = await queryMany(
      `SELECT sv.id, sv.sub_variant_name,
              COALESCE(sv.weight_grams, pv.weight_grams, p.weight_grams, 500) AS weight_grams,
              COALESCE(sv.package_type, pv.package_type, p.package_type) AS package_type,
              COALESCE(sv.length_cm, pv.length_cm, p.length_cm) AS length_cm,
              COALESCE(sv.breadth_cm, pv.breadth_cm, p.breadth_cm) AS breadth_cm,
              COALESCE(sv.height_cm, pv.height_cm, p.height_cm) AS height_cm
       FROM product_sub_variants sv
       JOIN product_variants pv ON pv.id = sv.variant_id
       JOIN products p ON p.id = sv.product_id
       WHERE sv.id = ANY($1::uuid[])`,
      [subVariantIds]
    )
    for (const item of cartItems.filter(i => i.subVariantId)) {
      const sv = (subVariants || []).find((r: any) => r.id === item.subVariantId)
      if (sv) {
        shipmentItems.push({
          packageType: (sv.package_type as PackageType) || null,
          weightGrams: resolveShipWeight(sv.weight_grams, bv),
          quantity: item.quantity || 1,
          storedDims: {
            length_cm:  sv.length_cm  ? parseFloat(sv.length_cm)  : null,
            breadth_cm: sv.breadth_cm ? parseFloat(sv.breadth_cm) : null,
            height_cm:  sv.height_cm  ? parseFloat(sv.height_cm)  : null,
          },
          variantName: sv.sub_variant_name,
        })
      }
    }
  }

  if (variantIds.length > 0) {
    const variants = await queryMany(
      `SELECT pv.id, pv.variant_name,
              COALESCE(pv.weight_grams, p.weight_grams, 500) AS weight_grams,
              COALESCE(pv.package_type, p.package_type) AS package_type,
              COALESCE(pv.length_cm, p.length_cm) AS length_cm,
              COALESCE(pv.breadth_cm, p.breadth_cm) AS breadth_cm,
              COALESCE(pv.height_cm, p.height_cm) AS height_cm
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.id = ANY($1::uuid[])`,
      [variantIds]
    )
    for (const item of cartItems.filter(i => i.variantId && !i.subVariantId)) {
      const v = (variants || []).find((r: any) => r.id === item.variantId)
      if (v) {
        shipmentItems.push({
          packageType: (v.package_type as PackageType) || null,
          weightGrams: resolveShipWeight(v.weight_grams, bv),
          quantity: item.quantity || 1,
          storedDims: {
            length_cm:  v.length_cm  ? parseFloat(v.length_cm)  : null,
            breadth_cm: v.breadth_cm ? parseFloat(v.breadth_cm) : null,
            height_cm:  v.height_cm  ? parseFloat(v.height_cm)  : null,
          },
          variantName: v.variant_name,
        })
      }
    }
  }

  if (productIds.length > 0) {
    const products = await queryMany(
      `SELECT id, name, weight_grams, package_type, length_cm, breadth_cm, height_cm
       FROM products WHERE id = ANY($1::uuid[])`,
      [productIds]
    )
    for (const item of cartItems.filter(i => !i.variantId && !i.subVariantId)) {
      const p = (products || []).find((r: any) => r.id === item.productId)
      if (p) {
        shipmentItems.push({
          packageType: (p.package_type as PackageType) || null,
          weightGrams: resolveShipWeight(p.weight_grams, bv),
          quantity: item.quantity || 1,
          storedDims: {
            length_cm:  p.length_cm  ? parseFloat(p.length_cm)  : null,
            breadth_cm: p.breadth_cm ? parseFloat(p.breadth_cm) : null,
            height_cm:  p.height_cm  ? parseFloat(p.height_cm)  : null,
          },
          variantName: p.name,
        })
      }
    }
  }

  if (shipmentItems.length === 0) {
    throw new Error('No valid cart items')
  }

  // Delhivery serviceability gate. The invoice/charges endpoint returns a rate even for
  // pincodes the carrier does not deliver to (that is how an order to 789171 slipped
  // through), so serviceability must be checked explicitly here — never quote or let an
  // order proceed to an unserviceable destination.
  const service = await checkPincodeServiceability(destinationPin, getCurrentTenantId() ?? undefined)
  if (!service.serviceable) {
    return {
      charge: 0, codFee: 0, totalCharge: 0,
      zone: '', source: 'unserviceable',
      chargedWeightGrams: 0, cartonCount: 0,
      serviceable: false,
      serviceCod: false,
      servicePrepaid: false,
      serviceError: service.error,
    }
  }

  const deliverySettings = await getDeliverySettings()
  const totalWeightGrams = shipmentItems.reduce((s, i) => s + i.weightGrams * i.quantity, 0)
  const freeCeilingKg = deliverySettings.freeWeightCeilingKg > 0 ? deliverySettings.freeWeightCeilingKg : 3

  if (!deliverySettings.enabled) {
    return {
      charge: 0, codFee: 0, totalCharge: 0,
      zone: 'Free', source: 'admin_disabled',
      chargedWeightGrams: totalWeightGrams, cartonCount: 0,
      serviceable: true, serviceCod: service.cod, servicePrepaid: service.prepaid,
    }
  }

  if (
    deliverySettings.freeThreshold > 0 &&
    typeof subtotal === 'number' &&
    subtotal >= deliverySettings.freeThreshold &&
    totalWeightGrams / 1000 < freeCeilingKg
  ) {
    return {
      charge: 0, codFee: 0, totalCharge: 0,
      zone: 'Free', source: 'free_threshold',
      chargedWeightGrams: totalWeightGrams, cartonCount: 0,
      freeShippingThreshold: deliverySettings.freeThreshold,
      serviceable: true, serviceCod: service.cod, servicePrepaid: service.prepaid,
    }
  }

  const cartons = packIntoCartons(shipmentItems, CARTON_MAX_WEIGHT_GRAMS)

  let totalCharge = 0
  let totalChargedWeight = 0
  let zone = ''
  let source: 'delhivery' | 'fallback' | 'rate_per_kg' = 'delhivery'
  const cartonBreakdown: RateBreakdown['cartons'] = []

  // An admin per-kg rate replaces the carrier quote outright, so skip the per-carton API calls
  // rather than paying for a rate that gets discarded.
  const usingRateOverride = deliverySettings.ratePerKg > 0

  if (usingRateOverride) {
    // Per-carton charges here are presentational only. applyDeliveryRules recomputes the
    // authoritative total from the summed charged weight, so summing these rounded shares
    // into totalCharge would let per-carton rounding drift off that total.
    source = 'rate_per_kg'
    for (const c of cartons) {
      totalChargedWeight += c.chargedWeightGrams
      cartonBreakdown.push({
        weightGrams: c.chargedWeightGrams,
        charge: round2(deliverySettings.ratePerKg * (c.chargedWeightGrams / 1000)),
        zone: '',
      })
    }
  } else if (TOKEN) {
    try {
      for (const c of cartons) {
        const r = await callDelhiveryForCarton(c, destinationPin, !!isCod, originPin, TOKEN)
        totalCharge += r.charge
        totalChargedWeight += r.chargedWeight
        zone = r.zone || zone
        cartonBreakdown.push({ weightGrams: c.chargedWeightGrams, charge: r.charge, zone: r.zone })
      }
    } catch {
      source = 'fallback'
      totalCharge = 0
      totalChargedWeight = 0
      cartonBreakdown.length = 0
    }
  } else {
    source = 'fallback'
  }

  if (source === 'fallback') {
    for (const c of cartons) {
      const r = fallbackShippingRate({
        chargedWeightGrams: c.chargedWeightGrams,
        destinationPin,
        originPin,
        cartonCount: cartons.length,
      })
      totalCharge += r.charge
      totalChargedWeight += c.chargedWeightGrams
      zone = r.zone
      cartonBreakdown.push({ weightGrams: c.chargedWeightGrams, charge: r.charge, zone: r.zone })
    }
  }

  // COD fee is computed separately — NOT folded into totalCharge so callers can show it as its own line.
  const codFee = isCod
    ? Math.round(Math.max(bv.codSurchargeFlat, (bv.codSurchargePct / 100) * (typeof subtotal === 'number' ? subtotal : 0)) * 100) / 100
    : 0

  // Carton-derived, so a per-kg rate prices identically whether the carrier quote succeeded,
  // fell back, or was skipped entirely — unlike totalChargedWeight, which is carrier-reported.
  const packedChargedWeightGrams = cartons.reduce((s, c) => s + c.chargedWeightGrams, 0)

  const ruleResult = applyDeliveryRules({
    baseCharge: round2(totalCharge),
    subtotal: typeof subtotal === 'number' ? subtotal : 0,
    settings: deliverySettings,
    weightGrams: totalWeightGrams,
    chargedWeightGrams: packedChargedWeightGrams,
  })

  // Min/max clamp the FINAL buyer-facing charge, after per-kg surcharge and delivery-rule
  // discounts — otherwise a per-kg surcharge added post-cap pushes the charge past the cap.
  // A charge that rules drove to 0 (free threshold / disabled / full discount) stays free.
  let finalCharge = ruleResult.charge
  if (finalCharge > 0) {
    if (bv.shippingMinCharge > 0 && finalCharge < bv.shippingMinCharge) finalCharge = bv.shippingMinCharge
    if (bv.shippingMaxCharge > 0 && finalCharge > bv.shippingMaxCharge) finalCharge = bv.shippingMaxCharge
  }

  const result: RateBreakdown = {
    charge: round2(finalCharge),
    codFee,
    totalCharge: round2(finalCharge + codFee),
    zone,
    source: ruleResult.source === 'as_is' ? source : ruleResult.source,
    chargedWeightGrams: totalChargedWeight,
    cartonCount: cartons.length,
    cartons: cartonBreakdown,
    serviceable: true,
    serviceCod: service.cod,
    servicePrepaid: service.prepaid,
  }
  if (deliverySettings.freeThreshold > 0) result.freeShippingThreshold = deliverySettings.freeThreshold

  return result
}
