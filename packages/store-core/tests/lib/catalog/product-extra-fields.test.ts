import { describe, it, expect } from 'vitest'
import {
  EXTRA_FIELDS,
  EXTRA_FIELD_KEYS,
  EXTRA_GROUP_LABEL,
  extraFieldInput,
  normalizeExtraFields,
  extraFieldsSetSql,
} from '@/lib/catalog/product-extra-fields'

describe('metadata', () => {
  it('EXTRA_FIELD_KEYS matches the field list and a label exists per group', () => {
    expect(EXTRA_FIELD_KEYS).toEqual(EXTRA_FIELDS.map(f => f.key))
    for (const f of EXTRA_FIELDS) expect(EXTRA_GROUP_LABEL[f.group]).toBeTruthy()
  })
})

describe('extraFieldInput', () => {
  it("'' for null/undefined", () => {
    expect(extraFieldInput('series', null)).toBe('')
    expect(extraFieldInput('series', undefined)).toBe('')
  })

  it('joins a list with commas; strings pass through', () => {
    expect(extraFieldInput('meta_keywords', ['a', 'b'])).toBe('a, b')
    expect(extraFieldInput('meta_keywords', 'a,b')).toBe('a,b')
  })

  it("bool → 'true'/'false'", () => {
    expect(extraFieldInput('downloadable', true)).toBe('true')
    expect(extraFieldInput('downloadable', 'true')).toBe('true')
    expect(extraFieldInput('downloadable', false)).toBe('false')
  })

  it('other values are stringified', () => {
    expect(extraFieldInput('moq', 5)).toBe('5')
    expect(extraFieldInput('unknown_key', 7)).toBe('7')
  })
})

describe('normalizeExtraFields — record source', () => {
  it('only keys present in src are emitted', () => {
    const out = normalizeExtraFields({ series: 'S' })
    expect(out).toEqual({ series: 'S' })
  })

  it('null value → false for bool, null otherwise', () => {
    const out = normalizeExtraFields({ downloadable: null, series: null })
    expect(out.downloadable).toBe(false)
    expect(out.series).toBeNull()
  })

  it('int: non-negative integer else null', () => {
    expect(normalizeExtraFields({ moq: '10' }).moq).toBe(10)
    expect(normalizeExtraFields({ moq: '-1' }).moq).toBeNull()
    expect(normalizeExtraFields({ moq: 'x' }).moq).toBeNull()
  })

  it('numeric: rounds to 3 dp, non-negative else null', () => {
    expect(normalizeExtraFields({ net_quantity: '1.23456' }).net_quantity).toBe(1.235)
    expect(normalizeExtraFields({ net_quantity: '-2' }).net_quantity).toBeNull()
  })

  it('bool: true for true/"true"/"on"', () => {
    expect(normalizeExtraFields({ downloadable: 'on' }).downloadable).toBe(true)
    expect(normalizeExtraFields({ downloadable: true }).downloadable).toBe(true)
    expect(normalizeExtraFields({ downloadable: 'no' }).downloadable).toBe(false)
  })

  it('list: trims, filters, caps 50, null when empty', () => {
    expect(normalizeExtraFields({ meta_keywords: 'a, ,b' }).meta_keywords).toEqual(['a', 'b'])
    expect(normalizeExtraFields({ meta_keywords: ['x', ' y '] }).meta_keywords).toEqual(['x', 'y'])
    expect(normalizeExtraFields({ meta_keywords: '  ' }).meta_keywords).toBeNull()
  })

  it('month: YYYY-MM only', () => {
    expect(normalizeExtraFields({ mfg_month_year: '2025-07' }).mfg_month_year).toBe('2025-07')
    expect(normalizeExtraFields({ mfg_month_year: '2025-13' }).mfg_month_year).toBeNull()
  })

  it('url: http(s) only, truncated to 2000', () => {
    expect(normalizeExtraFields({ source_url: 'https://x.com/a' }).source_url).toBe('https://x.com/a')
    expect(normalizeExtraFields({ source_url: 'ftp://x' }).source_url).toBeNull()
    expect((normalizeExtraFields({ source_url: 'https://x.com/' + 'a'.repeat(3000) }).source_url as string).length).toBe(2000)
  })

  it('text: trims and applies max; empty → null', () => {
    expect(normalizeExtraFields({ model_number: '  M1  ' }).model_number).toBe('M1')
    expect(normalizeExtraFields({ dimensions: '  ' }).dimensions).toBeNull()
  })

  it('select: valid option kept, invalid → null', () => {
    expect(normalizeExtraFields({ net_quantity_unit: 'kg' }).net_quantity_unit).toBe('kg')
    expect(normalizeExtraFields({ net_quantity_unit: 'zz' }).net_quantity_unit).toBeNull()
  })
})

describe('normalizeExtraFields — function source', () => {
  it('uses getter; undefined means "not present"', () => {
    const src = (k: string) => (k === 'series' ? 'S' : undefined)
    const out = normalizeExtraFields(src)
    expect(out).toEqual({ series: 'S' })
  })
})

describe('extraFieldsSetSql', () => {
  it("'' when no known keys", () => {
    expect(extraFieldsSetSql(['not_a_field'], '$1')).toBe('')
    expect(extraFieldsSetSql([], '$1')).toBe('')
  })

  it('builds a jsonb_populate_record assignment for known keys', () => {
    const sql = extraFieldsSetSql(['series', 'moq', 'bogus'], '$2')
    expect(sql).toBe('(series, moq) = (SELECT r.series, r.moq FROM jsonb_populate_record(NULL::products, $2) r)')
  })
})
