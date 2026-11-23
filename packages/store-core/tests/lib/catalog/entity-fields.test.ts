import { describe, it, expect } from 'vitest'
import {
  parseField,
  parseFields,
  parseBodyFields,
  contentOfSpecs,
  specUpdate,
  specLabels,
  type FieldSpec,
} from '@/lib/catalog/entity-fields'

const spec = (over: Partial<FieldSpec>): FieldSpec => ({ key: 'k', label: 'K', kind: 'text', section: 'S', ...over })

describe('parseField', () => {
  it('int: parses, clamps to min/maxValue, else null', () => {
    const s = spec({ kind: 'int', min: 0, maxValue: 60 })
    expect(parseField(s, '12')).toBe(12)
    expect(parseField(s, '-1')).toBeNull()
    expect(parseField(s, '61')).toBeNull()
    expect(parseField(s, 'abc')).toBeNull()
  })

  it('decimal: parseFloat with bounds', () => {
    const s = spec({ kind: 'decimal', min: 0, maxValue: 100 })
    expect(parseField(s, '12.5')).toBe(12.5)
    expect(parseField(s, '200')).toBeNull()
  })

  it('bool: truthy string/boolean set, else false', () => {
    const s = spec({ kind: 'bool' })
    for (const v of [true, 'true', 'on', '1']) expect(parseField(s, v)).toBe(true)
    for (const v of [false, 'false', 'no', '']) expect(parseField(s, v)).toBe(false)
  })

  it('tristate: true/false/null', () => {
    const s = spec({ kind: 'tristate' })
    expect(parseField(s, 'true')).toBe(true)
    expect(parseField(s, false)).toBe(false)
    expect(parseField(s, 'maybe')).toBeNull()
  })

  it('list: splits, trims, dedupes, caps at 50', () => {
    const s = spec({ kind: 'list' })
    expect(parseField(s, 'a, b\nc, a')).toEqual(['a', 'b', 'c'])
    expect(parseField(s, ['x', ' x ', 'y'])).toEqual(['x', 'y'])
    expect((parseField(s, Array.from({ length: 60 }, (_, i) => `i${i}`)) as string[]).length).toBe(50)
  })

  it('links: keeps only non-empty subkeys', () => {
    const s = spec({ kind: 'links', subkeys: ['instagram', 'youtube'] })
    expect(parseField(s, { instagram: ' a ', youtube: '', x: 'z' })).toEqual({ instagram: 'a' })
    expect(parseField(s, 'not-an-object')).toEqual({})
  })

  it('select: only a valid option, else null', () => {
    const s = spec({ kind: 'select', options: [{ value: 'grid', label: 'G' }] })
    expect(parseField(s, 'grid')).toBe('grid')
    expect(parseField(s, 'nope')).toBeNull()
  })

  it('color: lowercased #rrggbb, else null', () => {
    const s = spec({ kind: 'color' })
    expect(parseField(s, '#ABCDEF')).toBe('#abcdef')
    expect(parseField(s, 'red')).toBeNull()
  })

  it('text: trims, applies max, null when empty', () => {
    expect(parseField(spec({ kind: 'text', max: 3 }), '  hello ')).toBe('hel')
    expect(parseField(spec({ kind: 'text' }), '   ')).toBeNull()
  })

  it('falls back to spec.fallback when the value is null', () => {
    expect(parseField(spec({ kind: 'text', fallback: 'DEF' }), '')).toBe('DEF')
    expect(parseField(spec({ kind: 'bool', fallback: true }), '')).toBe(false) // bool never null, no fallback path
  })
})

describe('parseFields (FormData)', () => {
  it('reads present keys only; links need any subkey present', () => {
    const fd = new FormData()
    fd.set('name', 'Acme')
    fd.set('links.instagram', '@me')
    const specs: FieldSpec[] = [
      spec({ key: 'name', kind: 'text' }),
      spec({ key: 'missing', kind: 'text' }),
      spec({ key: 'links', kind: 'links', subkeys: ['instagram', 'youtube'] }),
    ]
    const out = parseFields(specs, fd)
    expect(out).toEqual({ name: 'Acme', links: { instagram: '@me' } })
    expect(out).not.toHaveProperty('missing')
  })

  it('skips a links field when no subkey is present', () => {
    const out = parseFields([spec({ key: 'links', kind: 'links', subkeys: ['x'] })], new FormData())
    expect(out).toEqual({})
  })
})

describe('parseBodyFields', () => {
  it('only keys present in the body', () => {
    const specs = [spec({ key: 'a', kind: 'int' }), spec({ key: 'b', kind: 'text' })]
    expect(parseBodyFields(specs, { a: '5' })).toEqual({ a: 5 })
  })
})

describe('contentOfSpecs', () => {
  it('normalises every spec key off the row', () => {
    const specs = [spec({ key: 'n', kind: 'int', min: 0 }), spec({ key: 't', kind: 'text' })]
    expect(contentOfSpecs(specs, { n: '3', t: ' hi ', other: 'x' })).toEqual({ n: 3, t: 'hi' })
  })
})

describe('specUpdate', () => {
  it('returns null when no spec key is present', () => {
    expect(specUpdate([spec({ key: 'a', kind: 'text' })], { b: 1 }, 2)).toBeNull()
  })

  it('builds SET with casts, params continuing from startAt, links stringified', () => {
    const specs = [
      spec({ key: 'name', kind: 'text' }),
      spec({ key: 'qty', kind: 'int', min: 0 }),
      spec({ key: 'links', kind: 'links', subkeys: ['x'] }),
    ]
    const out = specUpdate(specs, { name: ' Acme ', qty: '7', links: { x: 'y' } }, 2)!
    expect(out.set).toBe('name = $2::text, qty = $3::integer, links = $4::jsonb')
    expect(out.params).toEqual(['Acme', 7, JSON.stringify({ x: 'y' })])
  })

  it('stringifies {} for a null links value', () => {
    const out = specUpdate([spec({ key: 'links', kind: 'links', subkeys: [] })], { links: null }, 1)!
    expect(out.params).toEqual([JSON.stringify({})])
  })
})

describe('specLabels', () => {
  it('maps key → label', () => {
    expect(specLabels([spec({ key: 'a', label: 'Alpha' }), spec({ key: 'b', label: 'Beta' })])).toEqual({ a: 'Alpha', b: 'Beta' })
  })
})
