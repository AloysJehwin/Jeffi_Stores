import { describe, it, expect } from 'vitest'
import { familyKey, splitFamilies } from '@/lib/brochure-pdf'

const p = (id: string, name: string) => ({ id, name, sku: id, slug: id } as any)

describe('familyKey — strips trailing size tokens', () => {
  it('collapses metric M-sizes of the same screw to one key', () => {
    expect(familyKey('Unbrako Button Head Socket Screw Metric 12.9 M5'))
      .toBe(familyKey('Unbrako Button Head Socket Screw Metric 12.9 M12'))
  })

  it('strips mm / inch / fraction sizes', () => {
    expect(familyKey('Socket Head Cap Screw 25mm')).toBe('socket head cap screw')
    expect(familyKey('Allen Key 1/2"')).toBe('allen key')
    expect(familyKey('Bar 10 x 40')).toBe('bar')
  })

  it('keeps a name with no size token intact', () => {
    expect(familyKey('Plain Washer')).toBe('plain washer')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(familyKey('  HEX   BOLT  M6 ')).toBe(familyKey('hex bolt m8'))
  })
})

describe('splitFamilies', () => {
  it('takes the first product per family as the representative, rest to list', () => {
    const products = [
      p('a', 'Hex Bolt M3'),
      p('b', 'Hex Bolt M4'),
      p('c', 'Hex Bolt M5'),
      p('d', 'Plain Washer'),
    ]
    const { representatives, rest } = splitFamilies(products)
    expect(representatives.map(r => r.id)).toEqual(['a', 'd'])
    expect(rest.map(r => r.id)).toEqual(['b', 'c'])
  })

  it('preserves input order and handles all-unique lists', () => {
    const products = [p('a', 'Nut'), p('b', 'Bolt'), p('c', 'Washer')]
    const { representatives, rest } = splitFamilies(products)
    expect(representatives).toHaveLength(3)
    expect(rest).toHaveLength(0)
  })

  it('returns empty for empty input', () => {
    expect(splitFamilies([])).toEqual({ representatives: [], rest: [] })
  })
})
