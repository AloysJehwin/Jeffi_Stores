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

export function resolvePackedDims(item: ShipmentItem): PackedDims {
  const pt = item.packageType ?? 'flat_poly_auto'
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

export function computeShipmentDims(items: ShipmentItem[]): ShipmentResult {
  let maxL = 0
  let maxB = 0
  let totalH = 0
  let totalWeight = 0

  for (const item of items) {
    const d = resolvePackedDims(item)
    if (d.length_cm > maxL) maxL = d.length_cm
    if (d.breadth_cm > maxB) maxB = d.breadth_cm
    totalH += d.height_cm * item.quantity
    totalWeight += item.weightGrams * item.quantity
  }

  const volumetricGrams = (maxL * maxB * totalH) / 5
  const chargedWeightGrams = Math.max(totalWeight, volumetricGrams)

  return {
    length_cm:             Math.ceil(maxL),
    breadth_cm:            Math.ceil(maxB),
    height_cm:             Math.ceil(totalH),
    actualWeightGrams:     totalWeight,
    volumetricWeightGrams: Math.round(volumetricGrams),
    chargedWeightGrams:    Math.round(chargedWeightGrams),
  }
}
