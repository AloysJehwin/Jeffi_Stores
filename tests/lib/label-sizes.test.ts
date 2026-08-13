import { describe, it, expect } from 'vitest'
import { LABEL_SIZES } from '@/lib/label-sizes'

describe('LABEL_SIZES', () => {
  it('exports an array of 6 sizes', () => {
    expect(LABEL_SIZES).toHaveLength(6)
  })

  it('each entry has required fields', () => {
    for (const spec of LABEL_SIZES) {
      expect(spec).toHaveProperty('size')
      expect(spec).toHaveProperty('widthPt')
      expect(spec).toHaveProperty('heightPt')
      expect(spec).toHaveProperty('label')
      expect(spec).toHaveProperty('widthMm')
      expect(spec).toHaveProperty('heightMm')
    }
  })

  it('pt values are mm values multiplied by 2.8346', () => {
    const MM = 2.8346
    for (const spec of LABEL_SIZES) {
      expect(spec.widthPt).toBeCloseTo(spec.widthMm * MM, 3)
      expect(spec.heightPt).toBeCloseTo(spec.heightMm * MM, 3)
    }
  })

  it('contains 30x20 size', () => {
    const found = LABEL_SIZES.find(s => s.size === '30x20')
    expect(found).toBeDefined()
    expect(found!.widthMm).toBe(30)
    expect(found!.heightMm).toBe(20)
  })

  it('contains 80x20 cable size', () => {
    const found = LABEL_SIZES.find(s => s.size === '80x20')
    expect(found).toBeDefined()
    expect(found!.label).toContain('Cable')
  })

  it('all pt values are positive numbers', () => {
    for (const spec of LABEL_SIZES) {
      expect(spec.widthPt).toBeGreaterThan(0)
      expect(spec.heightPt).toBeGreaterThan(0)
    }
  })
})
