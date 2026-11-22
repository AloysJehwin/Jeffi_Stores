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
} from '@/lib/catalog/units'

describe('catalog tables', () => {
  it('ALL_DIMENSIONS and labels cover every dimension', () => {
    expect(ALL_DIMENSIONS).toEqual(['count', 'length', 'area', 'volume', 'weight', 'custom'])
    for (const d of ALL_DIMENSIONS) expect(typeof DIMENSION_LABEL[d]).toBe('string')
  })
})

describe('getUnitDef', () => {
  it('finds a unit by key', () => {
    expect(getUnitDef('length', 'ft')?.toSi).toBe(0.3048)
  })
  it('undefined for unknown key or dimension', () => {
    expect(getUnitDef('length', 'nope')).toBeUndefined()
    expect(getUnitDef('nope' as any, 'm')).toBeUndefined()
  })
})

describe('siBaseUnit', () => {
  it('returns the SI base of a typed dimension', () => {
    expect(siBaseUnit('length')?.key).toBe('m')
    expect(siBaseUnit('weight')?.key).toBe('kg')
  })
  it('count base is pc; custom has none', () => {
    expect(siBaseUnit('count')?.key).toBe('pc')
    expect(siBaseUnit('custom')).toBeUndefined()
  })
})

describe('convertSameDimension', () => {
  it('converts ft to m', () => {
    const ft = getUnitDef('length', 'ft')!
    const m = getUnitDef('length', 'm')!
    expect(convertSameDimension(10, ft, m)).toBeCloseTo(3.048, 6)
  })
  it('throws when a unit lacks an SI multiplier', () => {
    const pc = getUnitDef('count', 'pc')!
    const m = getUnitDef('length', 'm')!
    expect(() => convertSameDimension(1, pc, m)).toThrow(/no SI multiplier/)
    expect(() => convertSameDimension(1, m, pc)).toThrow(/no SI multiplier/)
  })
})

describe('computeAreaFactor', () => {
  it('4ft x 8ft in m² ≈ 2.9729', () => {
    expect(computeAreaFactor({ length: 4, width: 8, dim_unit: 'ft' }, 'm2')).toBeCloseTo(2.9729, 3)
  })
  it('1m x 1m into cm² = 10000', () => {
    expect(computeAreaFactor({ length: 1, width: 1, dim_unit: 'm' }, 'cm2')).toBeCloseTo(10000, 2)
  })
  it('throws on bad side or base unit', () => {
    expect(() => computeAreaFactor({ length: 1, width: 1, dim_unit: 'xx' }, 'm2')).toThrow(/Bad units/)
    expect(() => computeAreaFactor({ length: 1, width: 1, dim_unit: 'ft' }, 'xx')).toThrow(/Bad units/)
  })
})

describe('computeVolumeFactor', () => {
  it('1m cube = 1000 L', () => {
    expect(computeVolumeFactor({ length: 1, width: 1, height: 1, dim_unit: 'm' }, 'L')).toBeCloseTo(1000, 3)
  })
  it('1m cube in ml = 1_000_000', () => {
    expect(computeVolumeFactor({ length: 1, width: 1, height: 1, dim_unit: 'm' }, 'ml')).toBeCloseTo(1_000_000, 0)
  })
  it('throws on bad units', () => {
    expect(() => computeVolumeFactor({ length: 1, width: 1, height: 1, dim_unit: 'xx' }, 'L')).toThrow(/Bad units/)
    expect(() => computeVolumeFactor({ length: 1, width: 1, height: 1, dim_unit: 'm' }, 'xx')).toThrow(/Bad units/)
  })
})

describe('sameDimensionFactor', () => {
  it('cm into m base = 0.01', () => {
    expect(sameDimensionFactor('cm', 'm', 'length')).toBeCloseTo(0.01, 6)
  })
  it('throws on bad units', () => {
    expect(() => sameDimensionFactor('xx', 'm', 'length')).toThrow(/Bad units for length/)
    expect(() => sameDimensionFactor('cm', 'xx', 'length')).toThrow(/Bad units for length/)
  })
})

describe('UNITS data integrity', () => {
  it('every dimension lists units with keys', () => {
    for (const d of ALL_DIMENSIONS) {
      expect(UNITS[d].length).toBeGreaterThan(0)
      for (const u of UNITS[d]) expect(typeof u.key).toBe('string')
    }
  })
})
