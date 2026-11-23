import { describe, it, expect } from 'vitest'
import {
  canonicalSpecKey,
  specKeySql,
  isJunkSpecValue,
  SPEC_JUNK_SQL,
  specValues,
  specLabel,
  COLUMN_SPEC_ALIASES,
  ALIASED_SPEC_KEYS,
  readSpecifications,
} from '@/lib/catalog/product-specs'

describe('canonicalSpecKey', () => {
  it('drops brackets, collapses space/underscore, lowercases', () => {
    expect(canonicalSpecKey('Thread Size')).toBe('thread size')
    expect(canonicalSpecKey('thread_size')).toBe('thread size')
    expect(canonicalSpecKey('Length Range (mm)')).toBe('length range mm')
    expect(canonicalSpecKey('length_range_mm')).toBe('length range mm')
  })
})

describe('specKeySql', () => {
  it('wraps the expression in the SQL twin', () => {
    expect(specKeySql('x')).toContain('lower(btrim(regexp_replace')
    expect(specKeySql('x')).toContain('x')
  })
})

describe('isJunkSpecValue / SPEC_JUNK_SQL', () => {
  it('flags placeholders case-insensitively', () => {
    for (const j of ['', 'NaN', 'NULL', 'undefined', 'N/A', '-', '  n/a  ']) expect(isJunkSpecValue(j)).toBe(true)
  })
  it('passes real values', () => {
    expect(isJunkSpecValue('M12')).toBe(false)
  })
  it('SPEC_JUNK_SQL lists the quoted values', () => {
    expect(SPEC_JUNK_SQL).toContain("'nan'")
    expect(SPEC_JUNK_SQL).toContain("'n/a'")
  })
})

describe('specValues', () => {
  it('flattens arrays, trims, drops junk + objects + repeats', () => {
    expect(specValues(['M12', ' M12 ', 'n/a', null, { x: 1 }, 'Steel'])).toEqual(['M12', 'Steel'])
  })
  it('wraps a scalar', () => {
    expect(specValues('Brass')).toEqual(['Brass'])
    expect(specValues(42)).toEqual(['42'])
  })
  it('empty for null/object-only', () => {
    expect(specValues(null)).toEqual([])
    expect(specValues([{ a: 1 }])).toEqual([])
  })
})

describe('specLabel', () => {
  it('keeps a value that already reads as a label', () => {
    expect(specLabel('Thread Size')).toBe('Thread Size')
  })
  it('humanizes snake_case', () => {
    expect(specLabel('thread_size')).toBe('Thread Size')
  })
  it('collapses whitespace first', () => {
    expect(specLabel('  Thread   Size ')).toBe('Thread Size')
  })
})

describe('COLUMN_SPEC_ALIASES / ALIASED_SPEC_KEYS', () => {
  it('flattens all alias values into the set', () => {
    expect(ALIASED_SPEC_KEYS.has('colour')).toBe(true)
    expect(ALIASED_SPEC_KEYS.has('hsn')).toBe(true)
    expect(COLUMN_SPEC_ALIASES.material).toContain('material type')
  })
})

describe('readSpecifications', () => {
  it('returns empty for non-objects', () => {
    expect(readSpecifications(null)).toEqual([])
    expect(readSpecifications('x')).toEqual([])
    expect(readSpecifications([1, 2])).toEqual([])
  })
  it('merges by canonical key and sorts by label', () => {
    const out = readSpecifications({ thread_size: 'M12', 'Thread Size': 'M14', material: 'Steel' })
    const thread = out.find(e => e.key === 'thread size')!
    expect(thread.values).toEqual(['M12', 'M14'])
    // "Thread Size" reads-as-label, so its label wins over the humanized snake_case
    expect(thread.label).toBe('Thread Size')
    // sorted: Material before Thread Size
    expect(out.map(e => e.label)).toEqual(['Material', 'Thread Size'])
  })
  it('skips keys that canonicalize to empty or have no values', () => {
    expect(readSpecifications({ '()': 'x', good: 'n/a' })).toEqual([])
  })
  it('does not duplicate values that differ only by case', () => {
    const out = readSpecifications({ color: 'Red', colour: 'red' })
    expect(out).toHaveLength(2) // color and colour are distinct canonical keys
  })
  it('merges same canonical key without case-dup values', () => {
    const out = readSpecifications({ Material: 'Steel', material: 'steel' })
    expect(out).toHaveLength(1)
    expect(out[0].values).toEqual(['Steel'])
  })
})
