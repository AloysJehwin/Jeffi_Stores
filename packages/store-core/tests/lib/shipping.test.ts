import { describe, it, expect } from 'vitest'
import {
  parseBoltLengthMm,
  resolvePackedDims,
  packIntoCartons,
  computeShipmentDims,
  fallbackShippingRate,
  PACKAGE_TYPE_LABELS,
  STORED_DIMS_REQUIRED,
  VOLUMETRIC_DIVISOR_CM3_PER_GRAM,
  CARTON_MAX_WEIGHT_GRAMS,
  type ShipmentItem,
  type StoredDims,
} from '@/lib/shipping/shipping'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nullDims: StoredDims = { length_cm: null, breadth_cm: null, height_cm: null }
const storedDims = (l: number, b: number, h: number): StoredDims => ({
  length_cm: l,
  breadth_cm: b,
  height_cm: h,
})

function item(overrides: Partial<ShipmentItem> & Pick<ShipmentItem, 'packageType'>): ShipmentItem {
  return {
    weightGrams: 200,
    quantity: 1,
    storedDims: nullDims,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('PACKAGE_TYPE_LABELS has an entry for every package type', () => {
    const types = [
      'flat_poly_auto',
      'flat_poly_s',
      'flat_poly_m',
      'flat_poly_l',
      'flat_poly_xl',
      'drill_bit_tube',
      'drill_bit_set_case',
      'corrugated_box',
      'long_tube',
    ] as const
    for (const t of types) {
      expect(PACKAGE_TYPE_LABELS).toHaveProperty(t)
    }
  })

  it('STORED_DIMS_REQUIRED includes drill_bit_tube, drill_bit_set_case, corrugated_box, long_tube', () => {
    expect(STORED_DIMS_REQUIRED).toContain('drill_bit_tube')
    expect(STORED_DIMS_REQUIRED).toContain('drill_bit_set_case')
    expect(STORED_DIMS_REQUIRED).toContain('corrugated_box')
    expect(STORED_DIMS_REQUIRED).toContain('long_tube')
  })

  it('VOLUMETRIC_DIVISOR_CM3_PER_GRAM is 5', () => {
    expect(VOLUMETRIC_DIVISOR_CM3_PER_GRAM).toBe(5)
  })

  it('CARTON_MAX_WEIGHT_GRAMS is 30000', () => {
    expect(CARTON_MAX_WEIGHT_GRAMS).toBe(30000)
  })
})

// ---------------------------------------------------------------------------
// parseBoltLengthMm
// ---------------------------------------------------------------------------

describe('parseBoltLengthMm', () => {
  it('returns null for plain variant names', () => {
    expect(parseBoltLengthMm('M6 Hex Bolt')).toBeNull()
    expect(parseBoltLengthMm('')).toBeNull()
    expect(parseBoltLengthMm('Red')).toBeNull()
  })

  it('parses metres — "1m" → 1000mm', () => {
    expect(parseBoltLengthMm('M10 × 1m')).toBe(1000)
  })

  it('parses metres with decimal — "1.5m" → 1500mm', () => {
    expect(parseBoltLengthMm('M12 1.5m rod')).toBe(1500)
  })

  it('parses mm after ×/x/X/*  —  "× 50mm" → 50', () => {
    expect(parseBoltLengthMm('M8 × 50mm')).toBe(50)
    expect(parseBoltLengthMm('M8 x 50mm')).toBe(50)
    expect(parseBoltLengthMm('M8 * 50mm')).toBe(50)
  })

  it('parses 3-4 digit standalone mm — "200mm" → 200', () => {
    expect(parseBoltLengthMm('M6 200mm')).toBe(200)
    expect(parseBoltLengthMm('M6 1000mm')).toBe(1000)
  })

  it('does NOT match 2-digit standalone mm (must be 3+ digits)', () => {
    // "50mm" standalone — only 2 digits, regex requires \b(\d{3,4})\s*mm\b
    expect(parseBoltLengthMm('M6 50mm hex bolt')).toBeNull()
  })

  it('parses inches after × — "× 2"" → 2*25.4', () => {
    expect(parseBoltLengthMm('M10 × 2"')).toBeCloseTo(50.8)
  })

  it('parses mixed fraction inches after × — "× 1-1/2"" → (1+1/2)*25.4', () => {
    expect(parseBoltLengthMm('M8 × 1-1/2"')).toBeCloseTo(38.1)
  })

  it('parses standalone inches — "3"" → 3*25.4', () => {
    expect(parseBoltLengthMm('3" bolt')).toBeCloseTo(76.2)
  })

  it('parses standalone mixed fraction inches — "2-3/4"" → (2+3/4)*25.4', () => {
    expect(parseBoltLengthMm('2-3/4" rod')).toBeCloseTo(69.85)
  })

  it('metres pattern takes priority over mm pattern', () => {
    // "1m" should be caught as metres before mm patterns fire
    expect(parseBoltLengthMm('M6 1m rod')).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// resolvePackedDims
// ---------------------------------------------------------------------------

describe('resolvePackedDims', () => {
  describe('flat_poly_s', () => {
    it('returns fixed S dims', () => {
      const dims = resolvePackedDims(item({ packageType: 'flat_poly_s', weightGrams: 50 }))
      expect(dims).toEqual({ length_cm: 15, breadth_cm: 10, height_cm: 3 })
    })
  })

  describe('flat_poly_m', () => {
    it('returns fixed M dims', () => {
      const dims = resolvePackedDims(item({ packageType: 'flat_poly_m', weightGrams: 300 }))
      expect(dims).toEqual({ length_cm: 20, breadth_cm: 15, height_cm: 4 })
    })
  })

  describe('flat_poly_l', () => {
    it('returns fixed L dims', () => {
      const dims = resolvePackedDims(item({ packageType: 'flat_poly_l', weightGrams: 800 }))
      expect(dims).toEqual({ length_cm: 25, breadth_cm: 20, height_cm: 5 })
    })
  })

  describe('flat_poly_xl', () => {
    it('returns fixed XL dims', () => {
      const dims = resolvePackedDims(item({ packageType: 'flat_poly_xl', weightGrams: 2000 }))
      expect(dims).toEqual({ length_cm: 30, breadth_cm: 25, height_cm: 5 })
    })
  })

  describe('flat_poly_auto', () => {
    it('≤100g → S dims', () => {
      expect(resolvePackedDims(item({ packageType: 'flat_poly_auto', weightGrams: 100 }))).toEqual({
        length_cm: 15,
        breadth_cm: 10,
        height_cm: 3,
      })
    })

    it('101g – 500g → M dims', () => {
      expect(resolvePackedDims(item({ packageType: 'flat_poly_auto', weightGrams: 500 }))).toEqual({
        length_cm: 20,
        breadth_cm: 15,
        height_cm: 4,
      })
    })

    it('501g – 1500g → L dims', () => {
      expect(resolvePackedDims(item({ packageType: 'flat_poly_auto', weightGrams: 1500 }))).toEqual({
        length_cm: 25,
        breadth_cm: 20,
        height_cm: 5,
      })
    })

    it('>1500g → XL dims', () => {
      expect(resolvePackedDims(item({ packageType: 'flat_poly_auto', weightGrams: 1501 }))).toEqual({
        length_cm: 30,
        breadth_cm: 25,
        height_cm: 5,
      })
    })

    it('null packageType treated as flat_poly_auto', () => {
      expect(resolvePackedDims(item({ packageType: null, weightGrams: 100 }))).toEqual({
        length_cm: 15,
        breadth_cm: 10,
        height_cm: 3,
      })
    })
  })

  describe('flat_poly_auto with long variantName → long_tube', () => {
    it('upgrades to long_tube when variant contains ≥100mm length', () => {
      // "200mm" bolt length → long_tube; resolvePackedDims should return long_tube shape
      const i = item({
        packageType: 'flat_poly_auto',
        weightGrams: 200,
        variantName: 'M6 200mm bolt',
        storedDims: nullDims,
      })
      const dims = resolvePackedDims(i)
      // long_tube uses breadth 8 and height 8
      expect(dims.breadth_cm).toBe(8)
      expect(dims.height_cm).toBe(8)
      // length should be ceil(200/10)+5 = 25
      expect(dims.length_cm).toBe(25)
    })

    it('does NOT upgrade when bolt length <100mm', () => {
      // "50mm" standalone doesn't match the 3-digit regex, so parseBoltLengthMm returns null
      const i = item({
        packageType: 'flat_poly_auto',
        weightGrams: 100,
        variantName: 'M4 short bolt',
        storedDims: nullDims,
      })
      const dims = resolvePackedDims(i)
      expect(dims).toEqual({ length_cm: 15, breadth_cm: 10, height_cm: 3 })
    })
  })

  describe('drill_bit_tube', () => {
    it('uses stored length_cm when provided', () => {
      const dims = resolvePackedDims(item({ packageType: 'drill_bit_tube', storedDims: storedDims(35, 6, 6) }))
      expect(dims).toEqual({ length_cm: 35, breadth_cm: 8, height_cm: 8 })
    })

    it('falls back to 30cm when stored length is null', () => {
      const dims = resolvePackedDims(item({ packageType: 'drill_bit_tube' }))
      expect(dims).toEqual({ length_cm: 30, breadth_cm: 8, height_cm: 8 })
    })
  })

  describe('long_tube', () => {
    it('derives length from variantName bolt length', () => {
      const i = item({
        packageType: 'long_tube',
        variantName: 'M10 × 1m threaded rod',
        storedDims: nullDims,
      })
      // boltMm = 1000, l = ceil(1000/10)+5 = 105
      const dims = resolvePackedDims(i)
      expect(dims.length_cm).toBe(105)
      expect(dims.breadth_cm).toBe(8)
      expect(dims.height_cm).toBe(8)
    })

    it('falls back to storedDims.length_cm when no variantName bolt length', () => {
      const i = item({
        packageType: 'long_tube',
        storedDims: storedDims(60, 0, 0),
        variantName: 'plain rod',
      })
      const dims = resolvePackedDims(i)
      expect(dims.length_cm).toBe(60)
    })

    it('falls back to 50cm when both variantName and storedDims are empty', () => {
      const dims = resolvePackedDims(item({ packageType: 'long_tube' }))
      expect(dims.length_cm).toBe(50)
    })
  })

  describe('corrugated_box', () => {
    it('uses stored dims when provided', () => {
      const dims = resolvePackedDims(item({ packageType: 'corrugated_box', storedDims: storedDims(40, 30, 20) }))
      expect(dims).toEqual({ length_cm: 40, breadth_cm: 30, height_cm: 20 })
    })

    it('falls back to 20×15×10 when stored dims are null', () => {
      const dims = resolvePackedDims(item({ packageType: 'corrugated_box' }))
      expect(dims).toEqual({ length_cm: 20, breadth_cm: 15, height_cm: 10 })
    })
  })

  describe('drill_bit_set_case', () => {
    it('uses stored dims when provided', () => {
      const dims = resolvePackedDims(item({ packageType: 'drill_bit_set_case', storedDims: storedDims(25, 20, 8) }))
      expect(dims).toEqual({ length_cm: 25, breadth_cm: 20, height_cm: 8 })
    })

    it('falls back to 20×15×10 when stored dims are null', () => {
      const dims = resolvePackedDims(item({ packageType: 'drill_bit_set_case' }))
      expect(dims).toEqual({ length_cm: 20, breadth_cm: 15, height_cm: 10 })
    })
  })
})

// ---------------------------------------------------------------------------
// packIntoCartons
// ---------------------------------------------------------------------------

describe('packIntoCartons', () => {
  it('returns empty array for empty item list', () => {
    expect(packIntoCartons([])).toEqual([])
  })

  it('single item quantity 1 produces one carton', () => {
    const cartons = packIntoCartons([item({ packageType: 'flat_poly_auto', weightGrams: 500, quantity: 1 })])
    expect(cartons).toHaveLength(1)
  })

  it('carton actualWeightGrams equals item weight for qty=1', () => {
    const cartons = packIntoCartons([item({ packageType: 'flat_poly_s', weightGrams: 80, quantity: 1 })])
    expect(cartons[0].actualWeightGrams).toBe(80)
  })

  it('chargedWeightGrams is max(actual, volumetric)', () => {
    // flat_poly_s: 15×10×3=450cm³; volumetric = 450/5 = 90g; actual = 80g → charged = 90
    const cartons = packIntoCartons([item({ packageType: 'flat_poly_s', weightGrams: 80, quantity: 1 })])
    expect(cartons[0].chargedWeightGrams).toBe(90)
  })

  it('charged weight is actual when actual > volumetric', () => {
    // flat_poly_auto with 2000g (XL: 30×25×5=3750cm³; volumetric=750g < 2000g)
    const cartons = packIntoCartons([item({ packageType: 'flat_poly_auto', weightGrams: 2000, quantity: 1 })])
    expect(cartons[0].chargedWeightGrams).toBe(cartons[0].actualWeightGrams)
  })

  it('high quantity splits into multiple cartons when weight exceeds max', () => {
    // Each unit = 10000g; maxCarton = 30000g → fits 3 per carton
    const cartons = packIntoCartons([item({ packageType: 'flat_poly_auto', weightGrams: 10000, quantity: 7 })])
    // 7 units: carton1=3, carton2=3, carton3=1
    expect(cartons.length).toBeGreaterThanOrEqual(2)
    const totalWeight = cartons.reduce((s, c) => s + c.actualWeightGrams, 0)
    expect(totalWeight).toBe(70000)
  })

  it('custom maxCartonWeightGrams is respected', () => {
    const cartons = packIntoCartons([item({ packageType: 'flat_poly_auto', weightGrams: 400, quantity: 10 })], 1000)
    // Total=4000g, maxCarton=1000g → 4 cartons
    expect(cartons.length).toBe(4)
  })

  it('multiple items each produce their own carton set', () => {
    const cartons = packIntoCartons([
      item({ packageType: 'flat_poly_s', weightGrams: 50, quantity: 1 }),
      item({ packageType: 'flat_poly_m', weightGrams: 300, quantity: 1 }),
    ])
    // Both flat-poly items consolidated into one weight pool → 1 carton
    expect(cartons).toHaveLength(1)
    expect(cartons[0].actualWeightGrams).toBe(350)
  })

  it('long_tube item produces carton with breadth=8 and height=8', () => {
    const cartons = packIntoCartons([
      item({
        packageType: 'long_tube',
        weightGrams: 300,
        quantity: 1,
        variantName: 'M10 × 1m rod',
      }),
    ])
    expect(cartons[0].breadth_cm).toBe(8)
    expect(cartons[0].height_cm).toBe(8)
  })

  it('zero-weight item: total weight is 0 so no carton is packed', () => {
    const cartons = packIntoCartons([item({ packageType: 'flat_poly_s', weightGrams: 0, quantity: 1 })])
    // total weight=0, while(remaining>0) never fires → empty array
    expect(cartons).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// computeShipmentDims
// ---------------------------------------------------------------------------

describe('computeShipmentDims', () => {
  it('returns all zeros for empty items array', () => {
    expect(computeShipmentDims([])).toEqual({
      length_cm: 0,
      breadth_cm: 0,
      height_cm: 0,
      actualWeightGrams: 0,
      volumetricWeightGrams: 0,
      chargedWeightGrams: 0,
    })
  })

  it('single item: dims and weights match single carton', () => {
    const result = computeShipmentDims([item({ packageType: 'flat_poly_s', weightGrams: 80, quantity: 1 })])
    expect(result.length_cm).toBe(15)
    expect(result.breadth_cm).toBe(10)
    expect(result.height_cm).toBe(3)
    expect(result.actualWeightGrams).toBe(80)
  })

  it('two items: consolidated into one carton, dims from largest item', () => {
    // flat_poly_s: 15×10×3, flat_poly_xl: 30×25×5 — xl is largest by volume
    const result = computeShipmentDims([
      item({ packageType: 'flat_poly_s', weightGrams: 50, quantity: 1 }),
      item({ packageType: 'flat_poly_xl', weightGrams: 2000, quantity: 1 }),
    ])
    expect(result.length_cm).toBe(30)
    expect(result.breadth_cm).toBe(25)
    // consolidated: single carton uses rep dims height (5, not sum 3+5)
    expect(result.height_cm).toBe(5)
    expect(result.actualWeightGrams).toBe(50 + 2000)
  })

  it('total chargedWeightGrams: consolidated carton uses max(actual, volumetric)', () => {
    // two flat_poly_s items: total actual=160g
    // flat_poly_s dims: 15×10×3=450cm³, volumetric=450/5000=0.09kg=90g
    // consolidated → 1 carton: actual=160g > volumetric=90g → charged=160
    const result = computeShipmentDims([
      item({ packageType: 'flat_poly_s', weightGrams: 80, quantity: 1 }),
      item({ packageType: 'flat_poly_s', weightGrams: 80, quantity: 1 }),
    ])
    expect(result.chargedWeightGrams).toBe(160)
  })
})

// ---------------------------------------------------------------------------
// fallbackShippingRate
// ---------------------------------------------------------------------------

describe('fallbackShippingRate', () => {
  const base = {
    chargedWeightGrams: 1000,
    originPin: '560001',
    cartonCount: 1,
  }

  it('source is always "fallback"', () => {
    const r = fallbackShippingRate({ ...base, destinationPin: '560002' })
    expect(r.source).toBe('fallback')
  })

  describe('Local zone (same first 2 digits)', () => {
    it('zone is Local for same-prefix pins', () => {
      const r = fallbackShippingRate({ ...base, destinationPin: '560099' })
      expect(r.zone).toBe('Local')
    })

    it('charge = round(49 + 30*1 + 0) = 79 for 1kg, 1 carton', () => {
      const r = fallbackShippingRate({ ...base, destinationPin: '560099' })
      expect(r.charge).toBe(79)
    })
  })

  describe('Regional zone (same first digit, different first two)', () => {
    it('zone is Regional', () => {
      // origin=560xxx, dest=590xxx — same first digit "5"
      const r = fallbackShippingRate({ ...base, destinationPin: '590001' })
      expect(r.zone).toBe('Regional')
    })

    it('charge = round(69 + 45*1) = 114', () => {
      const r = fallbackShippingRate({ ...base, destinationPin: '590001' })
      expect(r.charge).toBe(114)
    })
  })

  describe('Metro zone (both in metro prefixes set)', () => {
    it('zone is Metro for two metro pins', () => {
      // 110001 → "11" is metro; 400001 → "40" is metro
      const r = fallbackShippingRate({
        ...base,
        originPin: '110001',
        destinationPin: '400001',
      })
      expect(r.zone).toBe('Metro')
    })

    it('charge = round(79 + 55*1) = 134', () => {
      const r = fallbackShippingRate({
        ...base,
        originPin: '110001',
        destinationPin: '400001',
      })
      expect(r.charge).toBe(134)
    })
  })

  describe('Special zone (destination starts with 7 or 8)', () => {
    // origin 500001 (prefix "50", not metro), dest 730001 (prefix "73", not metro, first digit "7")
    // different first digits, neither is metro → hits the d1==='7' Special branch
    it('zone is Special for dest starting with 7 (non-metro prefix)', () => {
      const r = fallbackShippingRate({ ...base, originPin: '500001', destinationPin: '730001' })
      expect(r.zone).toBe('Special')
    })

    it('zone is Special for dest starting with 8 (non-metro prefix)', () => {
      const r = fallbackShippingRate({ ...base, originPin: '500001', destinationPin: '830001' })
      expect(r.zone).toBe('Special')
    })

    it('charge = round(119 + 95*1) = 214 for 1kg', () => {
      const r = fallbackShippingRate({ ...base, originPin: '500001', destinationPin: '730001' })
      expect(r.charge).toBe(214)
    })
  })

  describe('Rest of India zone', () => {
    // origin 500001 (prefix "50", not metro), dest 220001 (prefix "22", not metro, first digit "2")
    // different first digit, not metro, not 7/8 → Rest of India
    it('zone is Rest of India for non-matching, non-metro, non-special pins', () => {
      const r = fallbackShippingRate({ ...base, originPin: '500001', destinationPin: '220001' })
      expect(r.zone).toBe('Rest of India')
    })

    it('charge = round(99 + 70*1) = 169', () => {
      const r = fallbackShippingRate({ ...base, originPin: '500001', destinationPin: '220001' })
      expect(r.charge).toBe(169)
    })
  })

  describe('minimum 0.5kg charged weight', () => {
    it('very light item (100g) still bills at 0.5kg minimum', () => {
      // Local zone: round(49 + 30*0.5) = round(64) = 64
      const r = fallbackShippingRate({ ...base, chargedWeightGrams: 100, destinationPin: '560099' })
      expect(r.charge).toBe(Math.round(49 + 30 * 0.5))
    })
  })

  describe('carton surcharge', () => {
    it('one carton has no surcharge', () => {
      const r1 = fallbackShippingRate({ ...base, destinationPin: '560099', cartonCount: 1 })
      const rMore = fallbackShippingRate({ ...base, destinationPin: '560099', cartonCount: 2 })
      // extra carton adds 25
      expect(rMore.charge - r1.charge).toBe(25)
    })

    it('three cartons adds 2*25=50 surcharge over single carton', () => {
      const r1 = fallbackShippingRate({ ...base, destinationPin: '560099', cartonCount: 1 })
      const r3 = fallbackShippingRate({ ...base, destinationPin: '560099', cartonCount: 3 })
      expect(r3.charge - r1.charge).toBe(50)
    })
  })
})
