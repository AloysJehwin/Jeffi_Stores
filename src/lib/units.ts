// Shared units catalog + cross-dimension conversion.
//
// Each unit belongs to a dimension. Within a dimension, each unit has an
// SI-equivalent multiplier so we can convert freely (e.g. ft -> m). Across
// dimensions there is no automatic conversion — admin enters a custom factor
// to bridge them (e.g. "1 roll = 50 m" stores factor=50; the system doesn't
// derive it).
//
// `count` and `custom` dimensions have no SI base; their factors are just
// admin-supplied multipliers.

export type Dimension = 'count' | 'length' | 'area' | 'volume' | 'weight' | 'custom'

export interface UnitDef {
  /** key used in product_units.unit and pricing_engine */
  key: string
  /** human label for UI */
  label: string
  /** for typed dimensions: how many SI base units this is. e.g. ft -> 0.3048 m */
  toSi?: number
  /** for length/weight/volume — the "natural" SI unit for that dimension */
  isSiBase?: boolean
  /** for count dimension: known fixed multiplier vs. pc (e.g. pair=2, dozen=12) */
  multiplier?: number
}

export const UNITS: Record<Dimension, UnitDef[]> = {
  count: [
    { key: 'pc', label: 'pc / pcs', isSiBase: true, multiplier: 1 },
    { key: 'pair', label: 'pair', multiplier: 2 },
    { key: 'set', label: 'set' },
    { key: 'box', label: 'box' },
    { key: 'pack', label: 'pack' },
    { key: 'roll', label: 'roll', multiplier: 1 },
    { key: 'sheet', label: 'sheet', multiplier: 1 },
    { key: 'bundle', label: 'bundle' },
    { key: 'case', label: 'case' },
    { key: 'kit', label: 'kit', multiplier: 1 },
    { key: 'dozen', label: 'dozen', multiplier: 12 },
  ],
  length: [
    { key: 'm', label: 'm', toSi: 1, isSiBase: true },
    { key: 'cm', label: 'cm', toSi: 0.01 },
    { key: 'mm', label: 'mm', toSi: 0.001 },
    { key: 'km', label: 'km', toSi: 1000 },
    { key: 'ft', label: 'ft', toSi: 0.3048 },
    { key: 'in', label: 'in', toSi: 0.0254 },
    { key: 'yd', label: 'yd', toSi: 0.9144 },
  ],
  area: [
    { key: 'm2', label: 'm²', toSi: 1, isSiBase: true },
    { key: 'cm2', label: 'cm²', toSi: 0.0001 },
    { key: 'ft2', label: 'ft²', toSi: 0.092903 },
    { key: 'in2', label: 'in²', toSi: 0.00064516 },
    { key: 'yd2', label: 'yd²', toSi: 0.836127 },
  ],
  volume: [
    { key: 'L', label: 'L', toSi: 1, isSiBase: true },
    { key: 'ml', label: 'ml', toSi: 0.001 },
    { key: 'gal', label: 'gal (US)', toSi: 3.78541 },
    { key: 'cl', label: 'cl', toSi: 0.01 },
  ],
  weight: [
    { key: 'kg', label: 'kg', toSi: 1, isSiBase: true },
    { key: 'g', label: 'g', toSi: 0.001 },
    { key: 'mg', label: 'mg', toSi: 0.000001 },
    { key: 'lb', label: 'lb', toSi: 0.453592 },
    { key: 'oz', label: 'oz', toSi: 0.0283495 },
    { key: 'mt', label: 'mt (tonne)', toSi: 1000 },
  ],
  custom: [
    { key: 'unit', label: 'unit (custom)' },
  ],
}

export const ALL_DIMENSIONS: Dimension[] = ['count', 'length', 'area', 'volume', 'weight', 'custom']

export const DIMENSION_LABEL: Record<Dimension, string> = {
  count: 'Count / Pieces',
  length: 'Length',
  area: 'Area',
  volume: 'Volume',
  weight: 'Weight',
  custom: 'Custom',
}

export function getUnitDef(dimension: Dimension, unitKey: string): UnitDef | undefined {
  return UNITS[dimension]?.find(u => u.key === unitKey)
}

export function siBaseUnit(dimension: Dimension): UnitDef | undefined {
  return UNITS[dimension]?.find(u => u.isSiBase)
}

/**
 * Convert a value from one unit to another within the SAME dimension.
 * Used when converting alternate units to the variant's base unit — e.g.
 * a base of `m²` and a value entered as `4 ft × 8 ft` (= 2.97 m²).
 */
export function convertSameDimension(value: number, fromUnit: UnitDef, toUnit: UnitDef): number {
  if (fromUnit.toSi === undefined || toUnit.toSi === undefined) {
    throw new Error(`Cannot convert: ${fromUnit.key} or ${toUnit.key} has no SI multiplier`)
  }
  return (value * fromUnit.toSi) / toUnit.toSi
}

/**
 * Compute the factor for an `area` unit defined by length × width.
 * e.g. computeAreaFactor({length: 4, width: 8, dim_unit: 'ft'}, baseUnitKey='m2')
 *      -> 2.9729
 */
export function computeAreaFactor(meta: { length: number; width: number; dim_unit: string }, baseUnitKey: string): number {
  const sideUnit = getUnitDef('length', meta.dim_unit)
  const baseUnit = getUnitDef('area', baseUnitKey)
  if (!sideUnit || !baseUnit || sideUnit.toSi === undefined || baseUnit.toSi === undefined) {
    throw new Error(`Bad units: side=${meta.dim_unit} base=${baseUnitKey}`)
  }
  // sides in m → area in m² → divide by base.toSi to express in base unit
  const areaInM2 = (meta.length * sideUnit.toSi) * (meta.width * sideUnit.toSi)
  return areaInM2 / baseUnit.toSi
}

/**
 * Compute the factor for a `volume` unit defined by length × width × height.
 */
export function computeVolumeFactor(meta: { length: number; width: number; height: number; dim_unit: string }, baseUnitKey: string): number {
  const sideUnit = getUnitDef('length', meta.dim_unit)
  const baseUnit = getUnitDef('volume', baseUnitKey)
  if (!sideUnit || !baseUnit || sideUnit.toSi === undefined || baseUnit.toSi === undefined) {
    throw new Error(`Bad units: side=${meta.dim_unit} base=${baseUnitKey}`)
  }
  // sides in m → volume in m³ (= 1000 L) → / base.toSi (which is liters per base unit)
  const volumeInM3 = (meta.length * sideUnit.toSi) * (meta.width * sideUnit.toSi) * (meta.height * sideUnit.toSi)
  const volumeInL = volumeInM3 * 1000
  return volumeInL / baseUnit.toSi
}

/**
 * Same-dimension factor — e.g. the variant base is `m` and admin adds a
 * 'cm' alternate. 1 cm = 0.01 m → factor 0.01.
 */
export function sameDimensionFactor(altUnitKey: string, baseUnitKey: string, dimension: Dimension): number {
  const alt = getUnitDef(dimension, altUnitKey)
  const base = getUnitDef(dimension, baseUnitKey)
  if (!alt || !base || alt.toSi === undefined || base.toSi === undefined) {
    throw new Error(`Bad units for ${dimension}: alt=${altUnitKey} base=${baseUnitKey}`)
  }
  return alt.toSi / base.toSi
}
