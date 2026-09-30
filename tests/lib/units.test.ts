import { describe, it, expect } from 'vitest'
import {
  UNITS,
  ALL_DIMENSIONS,
  DIMENSION_LABEL,
  getUnitDef,
  siBaseUnit,
  convertSameDimension,
  computeAreaFactor,
  computeVolumeFactor,
  sameDimensionFactor,
  type Dimension,
} from '@/lib/units'

// ---------------------------------------------------------------------------
// Static catalogue
// ---------------------------------------------------------------------------
describe('UNITS catalogue', () => {
  it('contains all expected dimensions', () => {
    expect(Object.keys(UNITS)).toEqual(
      expect.arrayContaining(['count', 'length', 'area', 'volume', 'weight', 'custom'])
    )
  })

  it('ALL_DIMENSIONS matches catalogue keys', () => {
    expect(ALL_DIMENSIONS).toEqual(expect.arrayContaining(['count', 'length', 'area', 'volume', 'weight', 'custom']))
    expect(ALL_DIMENSIONS.length).toBe(6)
  })

  it('DIMENSION_LABEL provides a label for every dimension', () => {
    for (const dim of ALL_DIMENSIONS) {
      expect(DIMENSION_LABEL[dim]).toBeTruthy()
    }
  })

  it('each unit in typed dimensions has a toSi value', () => {
    const typedDims: Dimension[] = ['length', 'area', 'volume', 'weight']
    for (const dim of typedDims) {
      for (const unit of UNITS[dim]) {
        expect(typeof unit.toSi).toBe('number')
      }
    }
  })

  it('each dimension has exactly one isSiBase unit', () => {
    const typedDims: Dimension[] = ['length', 'area', 'volume', 'weight']
    for (const dim of typedDims) {
      const bases = UNITS[dim].filter(u => u.isSiBase)
      expect(bases.length).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// getUnitDef
// ---------------------------------------------------------------------------
describe('getUnitDef', () => {
  it('returns the unit definition for a known unit', () => {
    const def = getUnitDef('length', 'm')
    expect(def).toBeDefined()
    expect(def?.key).toBe('m')
    expect(def?.toSi).toBe(1)
    expect(def?.isSiBase).toBe(true)
  })

  it('returns undefined for an unknown key', () => {
    expect(getUnitDef('length', 'furlong')).toBeUndefined()
  })

  it('returns undefined for an unknown dimension', () => {
    // TypeScript would prevent this at compile time, but safe to guard at runtime
    expect(getUnitDef('unknown' as Dimension, 'm')).toBeUndefined()
  })

  it('returns pair definition from count dimension', () => {
    const def = getUnitDef('count', 'pair')
    expect(def?.multiplier).toBe(2)
  })

  it('returns dozen definition with multiplier 12', () => {
    const def = getUnitDef('count', 'dozen')
    expect(def?.multiplier).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// siBaseUnit
// ---------------------------------------------------------------------------
describe('siBaseUnit', () => {
  it('returns kg for weight', () => {
    expect(siBaseUnit('weight')?.key).toBe('kg')
  })

  it('returns m for length', () => {
    expect(siBaseUnit('length')?.key).toBe('m')
  })

  it('returns m2 for area', () => {
    expect(siBaseUnit('area')?.key).toBe('m2')
  })

  it('returns L for volume', () => {
    expect(siBaseUnit('volume')?.key).toBe('L')
  })

  it('returns pc for count', () => {
    expect(siBaseUnit('count')?.key).toBe('pc')
  })

  it('returns undefined for unknown dimension', () => {
    expect(siBaseUnit('unknown' as Dimension)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// convertSameDimension
// ---------------------------------------------------------------------------
describe('convertSameDimension', () => {
  it('converts feet to metres', () => {
    const ft = getUnitDef('length', 'ft')!
    const m = getUnitDef('length', 'm')!
    const result = convertSameDimension(1, ft, m)
    expect(result).toBeCloseTo(0.3048, 4)
  })

  it('converts metres to centimetres', () => {
    const m = getUnitDef('length', 'm')!
    const cm = getUnitDef('length', 'cm')!
    expect(convertSameDimension(1, m, cm)).toBeCloseTo(100, 4)
  })

  it('converts km to m', () => {
    const km = getUnitDef('length', 'km')!
    const m = getUnitDef('length', 'm')!
    expect(convertSameDimension(2, km, m)).toBeCloseTo(2000, 4)
  })

  it('identity conversion returns same value', () => {
    const m = getUnitDef('length', 'm')!
    expect(convertSameDimension(5, m, m)).toBeCloseTo(5, 4)
  })

  it('converts kg to g', () => {
    const kg = getUnitDef('weight', 'kg')!
    const g = getUnitDef('weight', 'g')!
    expect(convertSameDimension(1, kg, g)).toBeCloseTo(1000, 4)
  })

  it('throws if fromUnit has no SI multiplier', () => {
    const noSi = { key: 'custom', label: 'custom' } // no toSi
    const m = getUnitDef('length', 'm')!
    expect(() => convertSameDimension(1, noSi, m)).toThrow()
  })

  it('throws if toUnit has no SI multiplier', () => {
    const noSi = { key: 'custom', label: 'custom' }
    const m = getUnitDef('length', 'm')!
    expect(() => convertSameDimension(1, m, noSi)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// computeAreaFactor
// ---------------------------------------------------------------------------
describe('computeAreaFactor', () => {
  it('computes area in m2 for a 4ft x 8ft panel', () => {
    // 4 ft = 4 * 0.3048 m = 1.2192 m
    // 8 ft = 8 * 0.3048 m = 2.4384 m
    // area = 1.2192 * 2.4384 = 2.97290 m²
    const result = computeAreaFactor({ length: 4, width: 8, dim_unit: 'ft' }, 'm2')
    expect(result).toBeCloseTo(2.9729, 2)
  })

  it('1m x 1m gives exactly 1 m2', () => {
    expect(computeAreaFactor({ length: 1, width: 1, dim_unit: 'm' }, 'm2')).toBeCloseTo(1, 6)
  })

  it('converts area to cm2 base unit', () => {
    // 1m x 1m = 1 m2 = 10000 cm2
    const result = computeAreaFactor({ length: 1, width: 1, dim_unit: 'm' }, 'cm2')
    expect(result).toBeCloseTo(10000, 2)
  })

  it('throws for an unknown side unit', () => {
    expect(() => computeAreaFactor({ length: 1, width: 1, dim_unit: 'furlong' }, 'm2')).toThrow()
  })

  it('throws for an unknown base area unit', () => {
    expect(() => computeAreaFactor({ length: 1, width: 1, dim_unit: 'm' }, 'acre' as any)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// computeVolumeFactor
// ---------------------------------------------------------------------------
describe('computeVolumeFactor', () => {
  it('1m x 1m x 1m = 1000 L', () => {
    const result = computeVolumeFactor({ length: 1, width: 1, height: 1, dim_unit: 'm' }, 'L')
    expect(result).toBeCloseTo(1000, 4)
  })

  it('10cm x 10cm x 10cm = 1 L', () => {
    const result = computeVolumeFactor({ length: 0.1, width: 0.1, height: 0.1, dim_unit: 'm' }, 'L')
    expect(result).toBeCloseTo(1, 4)
  })

  it('throws for unknown side unit', () => {
    expect(() => computeVolumeFactor({ length: 1, width: 1, height: 1, dim_unit: 'fathom' }, 'L')).toThrow()
  })

  it('throws for unknown base volume unit', () => {
    expect(() => computeVolumeFactor({ length: 1, width: 1, height: 1, dim_unit: 'm' }, 'barrel' as any)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// sameDimensionFactor
// ---------------------------------------------------------------------------
describe('sameDimensionFactor', () => {
  it('cm → m gives factor 0.01', () => {
    expect(sameDimensionFactor('cm', 'm', 'length')).toBeCloseTo(0.01, 6)
  })

  it('m → cm gives factor 100', () => {
    expect(sameDimensionFactor('m', 'cm', 'length')).toBeCloseTo(100, 6)
  })

  it('same unit gives factor 1', () => {
    expect(sameDimensionFactor('m', 'm', 'length')).toBeCloseTo(1, 6)
  })

  it('g → kg gives factor 0.001', () => {
    expect(sameDimensionFactor('g', 'kg', 'weight')).toBeCloseTo(0.001, 6)
  })

  it('ft → m gives factor ~0.3048', () => {
    expect(sameDimensionFactor('ft', 'm', 'length')).toBeCloseTo(0.3048, 4)
  })

  it('throws for unknown alt unit', () => {
    expect(() => sameDimensionFactor('furlong', 'm', 'length')).toThrow()
  })

  it('throws for unknown base unit', () => {
    expect(() => sameDimensionFactor('m', 'furlong', 'length')).toThrow()
  })

  it('throws for units without toSi (count dimension)', () => {
    // count units (except pc/pair) have no toSi
    expect(() => sameDimensionFactor('box', 'pc', 'count')).toThrow()
  })
})
