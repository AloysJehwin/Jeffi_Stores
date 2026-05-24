export type PackageType =
  | 'flat_poly_s'
  | 'flat_poly_m'
  | 'flat_poly_l'
  | 'flat_poly_xl'
  | 'flat_poly_auto'
  | 'drill_bit_tube'
  | 'drill_bit_set_case'
  | 'corrugated_box'
  | 'long_tube'

export const PACKAGE_TYPE_LABELS: Record<PackageType, string> = {
  flat_poly_auto:    'Flat Poly (auto by weight)',
  flat_poly_s:       'Flat Poly S (≤100g)',
  flat_poly_m:       'Flat Poly M (≤500g)',
  flat_poly_l:       'Flat Poly L (≤1500g)',
  flat_poly_xl:      'Flat Poly XL (>1500g)',
  drill_bit_tube:    'Drill Bit Tube',
  drill_bit_set_case:'Drill Bit Set Case',
  corrugated_box:    'Corrugated Box',
  long_tube:         'Long Tube / Rod / Pipe',
}

export const STORED_DIMS_REQUIRED: PackageType[] = [
  'drill_bit_tube',
  'drill_bit_set_case',
  'corrugated_box',
  'long_tube',
]

export const VOLUMETRIC_DIVISOR_CM3_PER_GRAM = 5
export const CARTON_MAX_WEIGHT_GRAMS = 30000

const LONG_ITEM_THRESHOLD_MM = 100

export interface StoredDims {
  length_cm: number | null
  breadth_cm: number | null
  height_cm: number | null
}

export interface PackedDims {
  length_cm: number
  breadth_cm: number
  height_cm: number
}

export interface ShipmentItem {
  packageType: PackageType | null
  weightGrams: number
  quantity: number
  storedDims: StoredDims
  variantName?: string
}

export interface ShipmentResult {
  length_cm: number
  breadth_cm: number
  height_cm: number
  actualWeightGrams: number
  volumetricWeightGrams: number
  chargedWeightGrams: number
}

export interface Carton {
  length_cm: number
  breadth_cm: number
  height_cm: number
  actualWeightGrams: number
  volumetricWeightGrams: number
  chargedWeightGrams: number
}

export function parseBoltLengthMm(variantName: string): number | null {
  let m = variantName.match(/\b(\d+(?:\.\d+)?)\s*m\b/i)
  if (m) return parseFloat(m[1]) * 1000

  m = variantName.match(/[×xX*]\s*(\d+(?:\.\d+)?)\s*mm/i)
  if (m) return parseFloat(m[1])

  m = variantName.match(/\b(\d{3,4})\s*mm\b/i)
  if (m) return parseFloat(m[1])

  m = variantName.match(/[×xX*]\s*(\d+(?:-\d+\/\d+)?)\s*"/i)
  if (m) {
    const raw = m[1]
    const mixed = raw.match(/^(\d+)-(\d+)\/(\d+)$/)
    if (mixed) return (parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])) * 25.4
    return parseFloat(raw) * 25.4
  }

  m = variantName.match(/\b(\d+(?:-\d+\/\d+)?)\s*"/i)
  if (m) {
    const raw = m[1]
    const mixed = raw.match(/^(\d+)-(\d+)\/(\d+)$/)
    if (mixed) return (parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])) * 25.4
    return parseFloat(raw) * 25.4
  }

  return null
}

function inferEffectivePackageType(item: ShipmentItem): PackageType {
  const declared = item.packageType ?? 'flat_poly_auto'
  if (declared === 'flat_poly_auto' && item.variantName) {
    const lengthMm = parseBoltLengthMm(item.variantName)
    if (lengthMm && lengthMm >= LONG_ITEM_THRESHOLD_MM) return 'long_tube'
  }
  return declared
}

export function resolvePackedDims(item: ShipmentItem): PackedDims {
  const pt = inferEffectivePackageType(item)
  const w = item.weightGrams
  const s = item.storedDims

  switch (pt) {
    case 'flat_poly_s':  return { length_cm: 15, breadth_cm: 10, height_cm: 3 }
    case 'flat_poly_m':  return { length_cm: 20, breadth_cm: 15, height_cm: 4 }
    case 'flat_poly_l':  return { length_cm: 25, breadth_cm: 20, height_cm: 5 }
    case 'flat_poly_xl': return { length_cm: 30, breadth_cm: 25, height_cm: 5 }

    case 'flat_poly_auto':
      if (w <= 100)  return { length_cm: 15, breadth_cm: 10, height_cm: 3 }
      if (w <= 500)  return { length_cm: 20, breadth_cm: 15, height_cm: 4 }
      if (w <= 1500) return { length_cm: 25, breadth_cm: 20, height_cm: 5 }
      return               { length_cm: 30, breadth_cm: 25, height_cm: 5 }

    case 'drill_bit_tube':
      return { length_cm: s.length_cm ?? 30, breadth_cm: 8, height_cm: 8 }

    case 'long_tube': {
      const boltMm = item.variantName ? parseBoltLengthMm(item.variantName) : null
      const l = boltMm ? Math.ceil(boltMm / 10) + 5 : (s.length_cm ?? 50)
      return { length_cm: l, breadth_cm: 8, height_cm: 8 }
    }

    case 'drill_bit_set_case':
    case 'corrugated_box':
    default:
      return {
        length_cm:  s.length_cm  ?? 20,
        breadth_cm: s.breadth_cm ?? 15,
        height_cm:  s.height_cm  ?? 10,
      }
  }
}

interface CartonAccumulator {
  maxL: number
  maxB: number
  totalH: number
  weightGrams: number
}

function finalizeCarton(c: CartonAccumulator): Carton {
  const volumetricGrams = (c.maxL * c.maxB * c.totalH) / VOLUMETRIC_DIVISOR_CM3_PER_GRAM
  const charged = Math.max(c.weightGrams, volumetricGrams)
  return {
    length_cm:             Math.ceil(c.maxL),
    breadth_cm:            Math.ceil(c.maxB),
    height_cm:             Math.ceil(c.totalH),
    actualWeightGrams:     Math.round(c.weightGrams),
    volumetricWeightGrams: Math.round(volumetricGrams),
    chargedWeightGrams:    Math.round(charged),
  }
}

const PACKING_VOID_FACTOR = 1.35
const MAX_CARTON_DIM_CM = 60

function deriveBulkCartonDims(
  unitDims: PackedDims,
  unitCount: number,
  isLongShape: boolean,
): PackedDims {
  if (unitCount <= 1) return unitDims
  const unitVolume = unitDims.length_cm * unitDims.breadth_cm * unitDims.height_cm
  const totalVolume = unitVolume * unitCount * PACKING_VOID_FACTOR

  if (isLongShape) {
    const longSide = Math.min(MAX_CARTON_DIM_CM, Math.max(unitDims.length_cm, unitDims.length_cm + 2))
    const crossSection = totalVolume / longSide
    const side = Math.max(8, Math.ceil(Math.sqrt(crossSection)))
    return { length_cm: Math.ceil(longSide), breadth_cm: side, height_cm: side }
  }

  const cubeSide = Math.cbrt(totalVolume)
  const dim = Math.max(15, Math.min(MAX_CARTON_DIM_CM, Math.ceil(cubeSide)))
  return { length_cm: dim, breadth_cm: dim, height_cm: dim }
}

export function packIntoCartons(
  items: ShipmentItem[],
  maxCartonWeightGrams = CARTON_MAX_WEIGHT_GRAMS,
): Carton[] {
  const cartons: Carton[] = []

  for (const item of items) {
    const unitDims = resolvePackedDims(item)
    const effectivePt = inferEffectivePackageType(item)
    const isLongShape = effectivePt === 'long_tube' || effectivePt === 'drill_bit_tube'
    const perUnitWeight = item.weightGrams
    let remaining = item.quantity

    while (remaining > 0) {
      const unitsThatFit = Math.max(1, Math.floor(maxCartonWeightGrams / Math.max(1, perUnitWeight)))
      const take = Math.min(remaining, unitsThatFit)
      const cartonDims = deriveBulkCartonDims(unitDims, take, isLongShape)
      const acc: CartonAccumulator = {
        maxL: cartonDims.length_cm,
        maxB: cartonDims.breadth_cm,
        totalH: cartonDims.height_cm,
        weightGrams: perUnitWeight * take,
      }
      cartons.push(finalizeCarton(acc))
      remaining -= take
    }
  }

  return cartons
}

export function computeShipmentDims(items: ShipmentItem[]): ShipmentResult {
  const cartons = packIntoCartons(items)
  if (cartons.length === 0) {
    return { length_cm: 0, breadth_cm: 0, height_cm: 0, actualWeightGrams: 0, volumetricWeightGrams: 0, chargedWeightGrams: 0 }
  }
  let maxL = 0, maxB = 0, totalH = 0, actual = 0, vol = 0, charged = 0
  for (const c of cartons) {
    if (c.length_cm > maxL) maxL = c.length_cm
    if (c.breadth_cm > maxB) maxB = c.breadth_cm
    totalH += c.height_cm
    actual += c.actualWeightGrams
    vol += c.volumetricWeightGrams
    charged += c.chargedWeightGrams
  }
  return {
    length_cm: maxL,
    breadth_cm: maxB,
    height_cm: totalH,
    actualWeightGrams: actual,
    volumetricWeightGrams: vol,
    chargedWeightGrams: charged,
  }
}

export interface FallbackRateInput {
  chargedWeightGrams: number
  destinationPin: string
  originPin: string
  cartonCount: number
}

export interface FallbackRateResult {
  charge: number
  zone: string
  source: 'fallback'
}

function inferZone(originPin: string, destPin: string): { zone: string; ratePerKg: number; baseRate: number } {
  const o2 = originPin.slice(0, 2)
  const d2 = destPin.slice(0, 2)
  if (o2 === d2) return { zone: 'Local', ratePerKg: 30, baseRate: 49 }
  const o1 = originPin[0]
  const d1 = destPin[0]
  if (o1 === d1) return { zone: 'Regional', ratePerKg: 45, baseRate: 69 }
  const metroPrefixes = new Set(['11', '40', '56', '60', '70'])
  if (metroPrefixes.has(o2) && metroPrefixes.has(d2)) return { zone: 'Metro', ratePerKg: 55, baseRate: 79 }
  if (d1 === '7' || d1 === '8') return { zone: 'Special', ratePerKg: 95, baseRate: 119 }
  return { zone: 'Rest of India', ratePerKg: 70, baseRate: 99 }
}

export function fallbackShippingRate(input: FallbackRateInput): FallbackRateResult {
  const { ratePerKg, baseRate, zone } = inferZone(input.originPin, input.destinationPin)
  const kg = Math.max(0.5, input.chargedWeightGrams / 1000)
  const cartonSurcharge = Math.max(0, input.cartonCount - 1) * 25
  const charge = Math.round(baseRate + ratePerKg * kg + cartonSurcharge)
  return { charge, zone, source: 'fallback' }
}
