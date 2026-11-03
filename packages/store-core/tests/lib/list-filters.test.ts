import { describe, it, expect } from 'vitest'
import {
  buildClauses,
  buildVectorSearchClause,
  buildWhere,
  canonicalQuery,
  csvCell,
  defineFields,
  escapeLike,
  filterScope,
  normalizeParams,
  normalizeQuery,
  paramNamesOf,
  splitFilterValues,
  valuesQuery,
  type FieldKeys,
  type FieldSql,
  type FilterEntity,
} from '@jeffi/list-filters'
import { ORDERS_ENTITY } from '@/lib/filters/entities/orders'
import { ORDER_FIELDS } from '@/lib/filters/fields/orders'

const FIELDS = defineFields({
  status: {
    label: 'Status',
    type: 'multi-select',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
  kind: { label: 'Kind', type: 'toggle', options: [{ value: 'x', label: 'X' }] },
  tag: { label: 'Tag', type: 'value-help' },
  amount: { label: 'Amount', type: 'range' },
  created: { name: ['from', 'to'], label: 'Created', type: 'date-range' },
  due: { label: 'Due', type: 'date-range' },
  paid: { label: 'Paid', type: 'toggle' },
  late: { label: 'Late', type: 'boolean' },
  code: { label: 'Code', type: 'text' },
  odd: { label: 'Odd', type: 'text' },
})

const SQL: Record<FieldKeys<typeof FIELDS>, FieldSql> = {
  status: { kind: 'enum', expr: 't.status' },
  kind: { kind: 'enum', virtual: { x: (ctx, bind) => `t.n > ${bind(ctx.n)}` } },
  tag: { kind: 'values', lateral: { from: 'tags g', link: 'g.t_id = t.id', expr: 'g.name' } },
  amount: { kind: 'range', expr: 't.amount' },
  created: { kind: 'date', expr: 't.created_at' },
  due: { kind: 'date', expr: 't.due', dateOnly: true },
  paid: { kind: 'bool', expr: 't.paid_at IS NOT NULL' },
  late: { kind: 'flag', expr: 't.late' },
  code: { kind: 'text', expr: 't.code', match: 'prefix' },
  odd: { kind: 'custom', build: (q, bind) => `t.odd = ${bind(q.odd)}` },
}

const E: FilterEntity<FieldKeys<typeof FIELDS>> = {
  key: 'things',
  scope: 'things:read',
  noun: 'Things',
  root: 'things',
  alias: 't',
  base: ['t.deleted_at IS NULL'],
  fields: FIELDS,
  sql: SQL,
  aliases: [
    { param: 'date_from', to: 'from' },
    { param: 'status', value: 'legacy', to: 'kind', set: 'x' },
  ],
  search: { build: (q, idx) => buildVectorSearchClause(q, 't.sv', [], ['t.code'], idx) },
  facets: true,
}

describe('value parsing', () => {
  it('splits pipes, and commas only for fixed options', () => {
    expect(splitFilterValues('a|b|a')).toEqual(['a', 'b'])
    expect(splitFilterValues('a,b')).toEqual(['a,b'])
    expect(splitFilterValues('a,b|c', { commas: true })).toEqual(['a', 'b', 'c'])
    const q = normalizeQuery(E, { status: 'a,b,zzz', tag: 'M8, zinc|M10' })
    expect(q.status).toBe('a|b')
    expect(q.tag).toBe('M8, zinc|M10')
  })

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
    expect(buildVectorSearchClause('a_b%', 'v', [], ['c'], 1).params[1]).toBe('%a\\_b\\%%')
  })

  it('drops unknown, reserved and invalid values', () => {
    const q = normalizeQuery(E, {
      tab: 'list',
      page: '2',
      nope: 'x',
      amount_min: 'abc',
      amount_max: '50',
      due_from: '2026-02-31',
      paid: 'maybe',
      late: '1',
    })
    expect(q).toEqual({ amount_max: '50', late: 'true' })
  })
})

describe('aliases', () => {
  it('renames params and moves single values', () => {
    const { params, changed } = normalizeParams({ date_from: '2026-01-01', status: 'a,legacy' }, E.aliases)
    expect(changed).toBe(true)
    expect(params.get('from')).toBe('2026-01-01')
    expect(params.get('date_from')).toBeNull()
    expect(params.get('status')).toBe('a')
    expect(params.get('kind')).toBe('x')
    expect(normalizeQuery(E, { status: 'legacy' })).toEqual({ kind: 'x' })
  })
})

describe('buildClauses', () => {
  it('builds every kind with start-index arithmetic', () => {
    const q = normalizeQuery(E, {
      status: 'a|b',
      kind: 'x',
      tag: 'red',
      amount_min: '10',
      from: '2026-10-01',
      to: '2026-10-10',
      due_to: '2026-11-01',
      paid: 'false',
      late: 'true',
      code: 'AB_',
      odd: 'y',
    })
    const c = buildClauses(E, q, 4, { ctx: { n: 7 } })
    expect(c.conditions).toEqual([
      't.status IN ($4, $5)',
      '(t.n > $6)',
      'EXISTS (SELECT 1 FROM tags g WHERE g.t_id = t.id AND lower(btrim(g.name)) IN (lower($7)))',
      't.amount >= $8::numeric',
      "t.created_at >= ($9::date)::timestamp AT TIME ZONE 'Asia/Kolkata'",
      "t.created_at < ($10::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'",
      't.due <= $11::date',
      'NOT (t.paid_at IS NOT NULL)',
      '(t.late)',
      "t.code ILIKE $12 || '%'",
      't.odd = $13',
    ])
    expect(c.params).toEqual(['a', 'b', 7, 'red', '10', '2026-10-01', '2026-10-10', '2026-11-01', 'AB\\_', 'y'])
    expect(c.nextIdx).toBe(14)
  })

  it('puts base, then search, then fields in the WHERE', () => {
    const w = buildWhere(E, normalizeQuery(E, { search: 'bolt', status: 'a' }), 1)
    expect(w.conditions[0]).toBe('t.deleted_at IS NULL')
    expect(w.conditions[1]).toContain('t.sv @@')
    expect(w.conditions[2]).toBe('t.status IN ($3)')
    expect(w.params).toEqual(['bolt:*', '%bolt%', 'a'])
    expect(buildWhere(E, {}, 1).where).toBe('WHERE t.deleted_at IS NULL')
  })

  it('scopes overviews and adds nothing without filters', () => {
    const none = filterScope(E, normalizeQuery(E, { from: '2026-10-01' }), { omit: ['created'] })
    expect(none.empty).toBe(true)
    expect(none.and(4)).toEqual({ sql: '', params: [] })
    const s = filterScope(E, normalizeQuery(E, { status: 'b' }))
    expect(s.and(4)).toEqual({ sql: ' AND t.status IN ($4)', params: ['b'] })
    expect(s.inIds('x.thing_id', 2).sql).toBe(
      ' AND x.thing_id IN (SELECT t.id FROM things t WHERE t.deleted_at IS NULL AND t.status IN ($2))'
    )
  })
})

describe('values', () => {
  it('lists values faceted on the other filters', () => {
    const v = valuesQuery(E, 'tag', normalizeQuery(E, { tag: 'red', status: 'a' }), { search: '5%', page: 2 })!
    expect(v.sql).toContain('CROSS JOIN LATERAL (SELECT btrim(g.name) AS val FROM tags g WHERE g.t_id = t.id) v')
    expect(v.sql).toContain('t.status IN ($1)')
    expect(v.sql).not.toContain('IN (lower(')
    expect(v.sql).toContain('LIMIT 51 OFFSET $3')
    expect(v.params).toEqual(['a', '%5\\%%', 50])
    expect(valuesQuery(E, 'status', {})).toBeNull()
  })
})

describe('helpers', () => {
  it('canonicalises a query to the list params in field order', () => {
    expect(canonicalQuery({ tab: 'list', status: 'b,a', search: ' x ', zzz: '1' }, FIELDS)).toBe(
      'search=x&status=b%7Ca'
    )
  })
  it('neutralises CSV formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('a,"b"')).toBe('"a,""b"""')
  })
})

describe('orders entity', () => {
  it('has SQL for every field and builds with every field set', () => {
    expect(Object.keys(ORDERS_ENTITY.sql).sort()).toEqual(ORDER_FIELDS.map(f => f.key).sort())
    const sp: Record<string, string> = {}
    for (const f of ORDER_FIELDS) {
      const names = paramNamesOf(f)
      if (f.type === 'range') [sp[names[0]], sp[names[1]]] = ['1', '9']
      else if (f.type === 'date-range') [sp[names[0]], sp[names[1]]] = ['2026-01-01', '2026-01-31']
      else if (f.options?.length) sp[names[0]] = f.options[0].value
      else if (f.type === 'boolean') sp[names[0]] = 'true'
      else sp[names[0]] = 'X'
    }
    const q = normalizeQuery(ORDERS_ENTITY, sp)
    expect(Object.keys(q).length).toBe(Object.keys(sp).length)
    const w = buildWhere(ORDERS_ENTITY, q, 1, { ctx: { handlingDays: 3 } })
    expect(w.conditions.length).toBeGreaterThan(ORDER_FIELDS.length)
    expect(new Set(w.where.match(/\$\d+/g)).size).toBe(w.params.length)
  })

  it('reads old order links', () => {
    const q = normalizeQuery(ORDERS_ENTITY, {
      date_from: '2026-01-01',
      coupon_code: 'SAVE10',
      shipment_status: 'in_transit,delivered',
      payment_mode: 'prepaid',
    })
    expect(q).toEqual({
      from: '2026-01-01',
      payment_type: 'prepaid',
      coupon: 'SAVE10',
      shipment_status: 'in_transit|delivered',
    })
  })
})
