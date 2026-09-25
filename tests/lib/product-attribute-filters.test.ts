import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ queryMany: vi.fn() }))

import { queryMany } from '@/lib/db'
import {
  ADMIN_PRODUCT_FILTER_FIELDS, filterParamNames, joinFilterValues, specKeyFromParam, specParam, splitFilterValues,
} from '@/lib/product-attribute-filters'
import {
  buildAttributeFilterClauses, getAttributeValues, getSpecFilterFields,
} from '@/lib/product-attribute-filters.server'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(queryMany).mockResolvedValue([])
})

describe('value lists in the URL', () => {
  it('joins with a pipe so values may contain commas', () => {
    const joined = joinFilterValues(['BS 4168, DIN 9841', 'IS 2269'])
    expect(splitFilterValues(joined)).toEqual(['BS 4168, DIN 9841', 'IS 2269'])
    expect(splitFilterValues(' a | | a |b ')).toEqual(['a', 'b'])
    expect(splitFilterValues(['x|y', 'z'])).toEqual(['x', 'y', 'z'])
    expect(splitFilterValues(undefined)).toEqual([])
  })

  it('round-trips spec keys through the param name', () => {
    expect(specParam('thread size')).toBe('spec.thread_size')
    expect(specKeyFromParam('spec.thread_size')).toBe('thread size')
    expect(specKeyFromParam('grade')).toBeNull()
    expect(specKeyFromParam('spec.')).toBeNull()
  })
})

describe('buildAttributeFilterClauses', () => {
  it('matches several picks case-insensitively and numbers params from the start index', () => {
    const { conditions, params, nextIdx } = buildAttributeFilterClauses({ grade: '8.8|10.9' }, 4)
    expect(params).toEqual(['8.8', '10.9', 'grade', 'material grade'])
    expect(nextIdx).toBe(8)
    expect(conditions).toHaveLength(1)
    expect(conditions[0]).toContain('SELECT btrim(p.grade) AS val UNION ALL')
    expect(conditions[0]).toContain('lower(s.val) IN (lower($4), lower($5))')
    expect(conditions[0]).toContain('IN ($6, $7)')
  })

  it('filters on a technical spec key with arrays and plain values alike', () => {
    const { conditions, params } = buildAttributeFilterClauses({ 'spec.thread_type': 'BSW|UNC' }, 1)
    expect(params).toEqual(['BSW', 'UNC', 'thread type'])
    expect(conditions[0]).toContain('jsonb_array_elements_text')
    expect(conditions[0]).toContain("jsonb_typeof(e.value) = 'array'")
  })

  it('splits comma lists for standards and folds country codes to upper case', () => {
    const std = buildAttributeFilterClauses({ compliance_standard: 'DIN 912' }, 1)
    expect(std.conditions[0]).toContain("regexp_split_to_table(p.compliance_standard, ',')")
    const country = buildAttributeFilterClauses({ country_of_origin: 'in' }, 1)
    expect(country.conditions).toEqual(['upper(btrim(p.country_of_origin)) IN (upper($1))'])
  })

  it('handles toggles, flags, multi-selects, ranges and dates', () => {
    const { conditions, params } = buildAttributeFilterClauses({
      is_featured: 'false', fragile: 'true', hazardous: 'false', gst_percentage: '5,18,abc',
      price_min: '10', stock_max: 'x', created_from: '2026-01-01', created_to: 'soon',
    }, 1)
    expect(conditions).toContain('p.is_featured = $1')
    expect(conditions).toContain('p.fragile = true')
    expect(conditions).toContain('p.hazardous = false')
    expect(conditions).toContain('p.gst_percentage IN ($2::numeric, $3::numeric)')
    expect(conditions.some(c => c.includes('>= $4::numeric'))).toBe(true)
    expect(conditions).toContain('p.created_at >= $5::date')
    expect(conditions.join(' ')).not.toContain('soon')
    expect(params).toEqual([false, '5', '18', '10', '2026-01-01'])
  })

  it('ignores params it does not know and empty values', () => {
    expect(buildAttributeFilterClauses({ search: 'x', page: 2, grade: '', material: '|' }, 1)).toEqual({ conditions: [], params: [], nextIdx: 1 })
  })
})

describe('getAttributeValues', () => {
  it('rejects unknown attributes', async () => {
    expect(await getAttributeValues('password', '', 1)).toBeNull()
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('lists a column merged with its spec aliases, searching literally', async () => {
    await getAttributeValues('material', '50%_off', 2)
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(sql).toContain('btrim(p.material)')
    expect(sql).toContain('jsonb_each')
    expect(sql).toContain('p.is_draft = false')
    expect(sql).toContain('GROUP BY lower(v.val)')
    expect(params).toEqual(['material', 'materials', 'material type', '%50\\%\\_off%', 50])
  })

  it('has a value source for every value-help field', async () => {
    const fields = ADMIN_PRODUCT_FILTER_FIELDS.filter(f => f.type === 'value-help')
    expect(fields.length).toBeGreaterThan(20)
    for (const f of fields) expect(await getAttributeValues(filterParamNames(f)[0], '', 1)).toEqual([])
  })
})

describe('getSpecFilterFields', () => {
  it('drops keys that restate a column and labels the rest', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { key: 'material', label: 'Material', raw: 'Material' },
      { key: 'thread type', label: 'Thread Type', raw: 'Thread Type' },
      { key: 'point angle', label: null, raw: 'point_angle' },
    ])
    const fields = await getSpecFilterFields()
    expect(fields.map(f => [f.name, f.label, f.type, f.section])).toEqual([
      ['spec.thread_type', 'Thread Type', 'value-help', 'Technical Specifications'],
      ['spec.point_angle', 'Point Angle', 'value-help', 'Technical Specifications'],
    ])
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual([2])
  })

  it('falls back to no spec filters when the query fails', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getSpecFilterFields()).toEqual([])
    err.mockRestore()
  })
})
