import { describe, it, expect } from 'vitest'
import {
  ALIASED_SPEC_KEYS, canonicalSpecKey, isJunkSpecValue, readSpecifications, specKeySql, specLabel, specValues,
} from '@/lib/product-specs'

describe('canonicalSpecKey', () => {
  it('meets however the key was typed', () => {
    expect(canonicalSpecKey('Thread Size')).toBe('thread size')
    expect(canonicalSpecKey('thread_size')).toBe('thread size')
    expect(canonicalSpecKey('  Thread__ Size ')).toBe('thread size')
    expect(canonicalSpecKey('Length Range (mm)')).toBe(canonicalSpecKey('length_range_mm'))
  })

  it('has an SQL twin over the same steps', () => {
    const sql = specKeySql('e.key')
    expect(sql).toContain("regexp_replace(e.key, '[()]', '', 'g')")
    expect(sql).toContain("'[_[:space:]]+', ' ', 'g'")
    expect(sql.startsWith('lower(btrim(')).toBe(true)
  })
})

describe('specValues', () => {
  it('expands arrays, trims, drops placeholders and repeats', () => {
    expect(specValues([' 125mm ', '150mm', '125MM', 'nan', ''])).toEqual(['125mm', '150mm'])
    expect(specValues('Metric')).toEqual(['Metric'])
    expect(specValues(12)).toEqual(['12'])
    expect(specValues(null)).toEqual([])
    expect(specValues({ a: 1 })).toEqual([])
  })

  it('treats n/a style values as empty', () => {
    expect(isJunkSpecValue(' N/A ')).toBe(true)
    expect(isJunkSpecValue('None')).toBe(false)
  })
})

describe('specLabel', () => {
  it('keeps a label as written, humanizes snake_case', () => {
    expect(specLabel('SST Life')).toBe('SST Life')
    expect(specLabel('thread_size')).toBe('Thread Size')
    expect(specLabel('hardness')).toBe('Hardness')
  })
})

describe('readSpecifications', () => {
  it('merges spellings of one key and prefers the label as written', () => {
    const out = readSpecifications({ thread_type: 'BSW', 'Thread Type': ['UNC', 'bsw'], Hardness: '36 HRc', empty: 'nan' })
    expect(out).toEqual([
      { key: 'hardness', label: 'Hardness', values: ['36 HRc'] },
      { key: 'thread type', label: 'Thread Type', values: ['BSW', 'UNC'] },
    ])
  })

  it('ignores anything that is not an object', () => {
    expect(readSpecifications(null)).toEqual([])
    expect(readSpecifications(['a'])).toEqual([])
    expect(readSpecifications('x')).toEqual([])
  })

  it('knows the spec keys that restate product columns', () => {
    expect(ALIASED_SPEC_KEYS.has('material')).toBe(true)
    expect(ALIASED_SPEC_KEYS.has('hsn code')).toBe(true)
    expect(ALIASED_SPEC_KEYS.has('thread type')).toBe(false)
  })
})
