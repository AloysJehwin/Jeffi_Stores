import { describe, it, expect } from 'vitest'
import { familyKey, nameSimilarity, sameFamily, splitFamilies } from '@/lib/brochure-pdf'

const p = (id: string, name: string) => ({ id, name, sku: id, slug: id } as any)

describe('familyKey — strips size tokens anywhere in the name', () => {
  it('strips embedded fraction sizes so BSW sizes share a key', () => {
    expect(familyKey('BSW 1/2" SS 202 Allen Cap Screw'))
      .toBe(familyKey('BSW 3/16" SS 202 Allen Cap Screw'))
  })
  it('strips embedded M-sizes', () => {
    expect(familyKey('GMF SS 304 M10 Allen Cap Screw'))
      .toBe(familyKey('GMF SS 304 M12 Allen Cap Screw'))
  })
  it('keeps grade/material numbers (202/304/12.9) intact', () => {
    expect(familyKey('BSW 1/2" SS 202 Allen Cap Screw')).toContain('202')
    expect(familyKey('GMF SS 304 M10 Allen Cap Screw')).toContain('304')
  })
  it('leaves a name with no size token intact', () => {
    expect(familyKey('Plain Washer')).toBe('plain washer')
  })
})

describe('nameSimilarity', () => {
  it('identical names → 1', () => {
    expect(nameSimilarity('Hex Bolt', 'hex   bolt')).toBe(1)
  })
  it('very different names → low', () => {
    expect(nameSimilarity('Plain Washer', 'Threaded Rod')).toBeLessThan(0.5)
  })
})

describe('sameFamily — similarity + size-only-diff gate', () => {
  it('collapses different sizes of the same product', () => {
    expect(sameFamily('BSW 1/2" SS 202 Allen Cap Screw', 'BSW 3/8" SS 202 Allen Cap Screw')).toBe(true)
  })
  it('keeps Cap vs CSK separate even when very similar', () => {
    expect(nameSimilarity('GMF SS 304 M10 Allen Cap Screw', 'GMF SS 304 M10 Allen CSK Screw')).toBeGreaterThan(0.8)
    expect(sameFamily('GMF SS 304 M10 Allen Cap Screw', 'GMF SS 304 M10 Allen CSK Screw')).toBe(false)
  })
  it('keeps different materials separate', () => {
    expect(sameFamily('Hex Bolt M6 Steel', 'Hex Bolt M6 Brass')).toBe(false)
  })
})

describe('splitFamilies', () => {
  it('one representative per family; other sizes to the list', () => {
    const products = [
      p('a', 'BSW 1/2" SS 202 Allen Cap Screw'),
      p('b', 'BSW 1/4" SS 202 Allen Cap Screw'),
      p('c', 'BSW 3/8" SS 202 Allen Cap Screw'),
      p('d', 'GMF SS 304 M10 Allen CSK Screw'),
      p('e', 'Plain Washer'),
    ]
    const { representatives, rest } = splitFamilies(products)
    expect(representatives.map(r => r.id)).toEqual(['a', 'd', 'e'])
    expect(rest.map(r => r.id)).toEqual(['b', 'c'])
  })

  it('all-unique list keeps everyone as a representative', () => {
    const products = [p('a', 'Nut'), p('b', 'Bolt'), p('c', 'Washer')]
    const { representatives, rest } = splitFamilies(products)
    expect(representatives).toHaveLength(3)
    expect(rest).toHaveLength(0)
  })

  it('empty input', () => {
    expect(splitFamilies([])).toEqual({ representatives: [], rest: [] })
  })
})
