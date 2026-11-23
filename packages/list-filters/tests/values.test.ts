import { describe, it, expect } from 'vitest'
import { isValuesField, valuesQuery, pageOfValues, VALUES_PAGE_SIZE } from '../src/values'
import { defineFields } from '../src/client'
import { unionEntity } from '../src/clauses'
import type { FieldSql, FilterEntity, FilterBranch } from '../src/types'

const FIELDS = defineFields({
  tags: { label: 'Tags', type: 'value-help' },
  status: { label: 'Status', type: 'multi-select' },
  created: { name: ['from', 'to'], label: 'Created', type: 'date-range' },
})
type K = (typeof FIELDS)[number]['key']
const SQL: Record<K, FieldSql> = {
  tags: { kind: 'values', expr: 't.tag' },
  status: { kind: 'enum', expr: 't.status' },
  created: { kind: 'date', expr: 't.created_at' },
}
const base: FilterEntity<K> = {
  key: 'things', scope: 's', noun: 'N', root: 'things', alias: 't', fields: FIELDS, sql: SQL, period: 'created',
}

describe('isValuesField', () => {
  it('true for a values field, false otherwise', () => {
    expect(isValuesField(base, 'tags')).toBe(true)
    expect(isValuesField(base, 'status')).toBe(false)
    expect(isValuesField(base, 'nope')).toBe(false)
  })
})

describe('valuesQuery', () => {
  it('null for a non-values field', () => {
    expect(valuesQuery(base, 'status', {})).toBeNull()
  })

  it('faceted: omits the field itself, builds the CROSS JOIN LATERAL mode() query', () => {
    const e = { ...base, facets: true }
    const r = valuesQuery(e, 'tags', { status: 'open' })
    expect(r).not.toBeNull()
    expect(r!.sql).toContain('CROSS JOIN LATERAL (SELECT btrim(t.tag) AS val) v')
    expect(r!.sql).toContain('mode() WITHIN GROUP (ORDER BY v.val)')
    expect(r!.sql).toContain('count(DISTINCT t.id)::int AS count')
    expect(r!.sql).toContain("v.val IS NOT NULL")
    expect(r!.sql).toContain("v.val <> ''")
    expect(r!.sql).toContain('GROUP BY lower(v.val)')
    expect(r!.sql).toContain(`LIMIT ${VALUES_PAGE_SIZE + 1}`)
    // status filter present (faceting on other fields), page offset bound
    expect(r!.params).toContain('open')
    expect(r!.pageSize).toBe(VALUES_PAGE_SIZE)
  })

  it('non-faceted windowed entity only filters its period', () => {
    const e = { ...base, defaultWindowDays: 30 }
    const r = valuesQuery(e, 'tags', { status: 'open', from: '2026-01-01' })
    // windowOnly → [period]; status should not appear, date should
    expect(r!.params).not.toContain('open')
  })

  it('search needle adds an ILIKE and binds escaped %needle%', () => {
    const r = valuesQuery({ ...base, facets: true }, 'tags', {}, { search: 'ab%' })
    expect(r!.sql).toContain('v.val ILIKE $')
    expect(r!.params).toContain('%ab\\%%')
  })

  it('page offset computed from page/pageSize', () => {
    const r = valuesQuery({ ...base, facets: true }, 'tags', {}, { page: 3, pageSize: 10 })
    expect(r!.params).toContain(20) // (3-1)*10
    expect(r!.pageSize).toBe(10)
  })

  it('respects a custom pk alias', () => {
    const r = valuesQuery({ ...base, facets: true, pk: 'uid' }, 'tags', {})
    expect(r!.sql).toContain('count(DISTINCT t.uid)::int')
  })
})

describe('valuesQuery — union entity', () => {
  const BR: [FilterBranch<'tags'>, FilterBranch<'tags'>] = [
    { key: 'a', root: 'ta', alias: 'a', sql: { tags: { kind: 'values', expr: 'a.tag' } } },
    { key: 'b', root: 'tb', alias: 'b', pk: 'bid', sql: { tags: { kind: 'values', expr: 'b.tag' } } },
  ]
  const U = unionEntity<'tags'>({
    key: 'u', scope: 's', noun: 'N',
    fields: defineFields({ tags: { label: 'T', type: 'value-help' } }),
    facets: true,
    branches: BR,
  })

  it('builds a UNION ALL over branch rows with rid and a surrounding mode()', () => {
    const r = valuesQuery(U, 'tags', {})
    expect(r).not.toBeNull()
    expect(r!.sql).toContain("'0:' || a.id AS rid")
    expect(r!.sql).toContain("'1:' || b.bid AS rid")
    expect(r!.sql).toContain('UNION ALL')
    expect(r!.sql).toContain('count(DISTINCT u.rid)::int AS count')
    expect(r!.sql).toContain('GROUP BY lower(u.val)')
  })

  it('non-faceted union uses windowOnly', () => {
    const U2 = { ...U, facets: false, period: 'tags' as const, defaultWindowDays: 7 }
    const r = valuesQuery(U2 as unknown as FilterEntity, 'tags', {})
    expect(r).not.toBeNull()
  })

  it('union with search needle binds escaped pattern', () => {
    const r = valuesQuery(U, 'tags', {}, { search: 'x_y' })
    expect(r!.params).toContain('%x\\_y%')
    expect(r!.sql).toContain('u.val ILIKE $')
  })
})

describe('pageOfValues', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ value: `v${i}`, count: i }))
  it('trims the look-ahead row and reports hasMore', () => {
    expect(pageOfValues(rows, 4)).toEqual({ values: rows.slice(0, 4), hasMore: true })
  })
  it('no extra → hasMore false', () => {
    expect(pageOfValues(rows, 5)).toEqual({ values: rows, hasMore: false })
    expect(pageOfValues(rows.slice(0, 3), 5).hasMore).toBe(false)
  })
})
