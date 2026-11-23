import { describe, it, expect } from 'vitest'
import {
  IST_FROM,
  IST_TO,
  searchParamOf,
  normalizeQuery,
  rowsSql,
  branchesOf,
  branchOf,
  unionEntity,
  buildClauses,
  buildWhere,
  hasFilters,
  filterScope,
  countQuery,
} from '../src/clauses'
import { defineFields } from '../src/client'
import type { FieldSql, FilterEntity, FilterBranch } from '../src/types'

// A single-table entity covering every FieldSql kind.
const FIELDS = defineFields({
  status: { label: 'Status', type: 'multi-select', options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }] },
  kind: { label: 'Kind', type: 'multi-select' }, // enum with virtual + exists + cast exercised separately
  tags: { label: 'Tags', type: 'value-help' },
  amount: { label: 'Amount', type: 'range' },
  created: { name: ['from', 'to'], label: 'Created', type: 'date-range' },
  due: { name: ['due_from', 'due_to'], label: 'Due', type: 'date-range' },
  active: { label: 'Active', type: 'toggle' },
  flagged: { label: 'Flagged', type: 'boolean' },
  name: { label: 'Name', type: 'text' },
  cust: { name: ['cust_id'], label: 'Custom', type: 'text' },
})

type K = (typeof FIELDS)[number]['key']

const SQL: Record<K, FieldSql> = {
  status: { kind: 'enum', expr: 't.status' },
  kind: {
    kind: 'enum',
    expr: 't.kind',
    cast: 'kind_type',
    exists: { from: 'tags g', link: 'g.tid = t.id' },
    virtual: { special: "t.special = true" },
  },
  tags: { kind: 'values', expr: 't.tag' },
  amount: { kind: 'range', expr: 't.amt' },
  created: { kind: 'date', expr: 't.created_at' },
  due: { kind: 'date', expr: 't.due_on', dateOnly: true },
  active: { kind: 'bool', expr: 't.active' },
  flagged: { kind: 'flag', expr: 't.flagged' },
  name: { kind: 'text', expr: 't.name' },
  cust: { kind: 'custom', build: (q, bind) => (q.cust_id ? `t.cid = ${bind(q.cust_id)}` : null) },
}

const ENTITY: FilterEntity<K> = {
  key: 'things',
  scope: 'things:read',
  noun: 'Things',
  root: 'things',
  alias: 't',
  base: ['t.deleted = false'],
  fields: FIELDS,
  sql: SQL,
  period: 'created',
  search: { param: 'search', build: (term, idx) => ({ clause: `t.name ILIKE $${idx}`, params: [`%${term}%`], nextIdx: idx + 1 }) },
}

describe('IST helpers', () => {
  it('wrap a placeholder as IST day bounds', () => {
    expect(IST_FROM('$1')).toBe("($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata'")
    expect(IST_TO('$1')).toBe("($1::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'")
  })
})

describe('searchParamOf', () => {
  it('returns the entity search param or the default', () => {
    expect(searchParamOf({ search: { param: 'q', build: () => ({ clause: '', params: [], nextIdx: 1 }) } } as FilterEntity)).toBe('q')
    expect(searchParamOf({} as FilterEntity)).toBe('search')
    expect(searchParamOf({ search: { build: () => ({ clause: '', params: [], nextIdx: 1 }) } } as FilterEntity)).toBe('search')
  })
})

describe('normalizeQuery', () => {
  it('keeps a trimmed search term', () => {
    expect(normalizeQuery(ENTITY, { search: '  hi  ' }).search).toBe('hi')
  })
  it('drops an empty search term', () => {
    expect(normalizeQuery(ENTITY, { search: '  ' }).search).toBeUndefined()
  })
  it('enum: keeps only known option/virtual values', () => {
    const q = normalizeQuery(ENTITY, { status: 'open,bogus', kind: 'special,unknown' })
    expect(q.status).toBe('open')
    expect(q.kind).toBe('special')
  })
  it('enum without options/virtual keeps all values', () => {
    const e = { ...ENTITY, fields: defineFields({ k: { label: 'K', type: 'multi-select' } }), sql: { k: { kind: 'enum', expr: 't.k' } as FieldSql } }
    expect(normalizeQuery(e as unknown as FilterEntity, { k: 'a,b' }).k).toBe('a|b')
  })
  it('values: uuid filter drops non-uuids', () => {
    const e = { ...ENTITY, fields: defineFields({ v: { label: 'V', type: 'value-help' } }), sql: { v: { kind: 'values', uuid: true } as FieldSql } }
    const good = '11111111-1111-1111-1111-111111111111'
    expect(normalizeQuery(e as unknown as FilterEntity, { v: `${good}|nope` }).v).toBe(good)
  })
  it('values without uuid keeps values', () => {
    expect(normalizeQuery(ENTITY, { tags: 'a|b' }).tags).toBe('a|b')
  })
  it('range: keeps numeric bounds, drops non-numeric', () => {
    const q = normalizeQuery(ENTITY, { amount_min: '5', amount_max: 'x' })
    expect(q.amount_min).toBe('5')
    expect(q.amount_max).toBeUndefined()
  })
  it('date: keeps valid ISO dates, drops bad ones', () => {
    const q = normalizeQuery(ENTITY, { from: '2026-01-15', to: '2026-13-40' })
    expect(q.from).toBe('2026-01-15')
    expect(q.to).toBeUndefined()
  })
  it('date: drops a non-pattern date', () => {
    expect(normalizeQuery(ENTITY, { from: 'yesterday' }).from).toBeUndefined()
  })
  it('bool: only true/false', () => {
    expect(normalizeQuery(ENTITY, { active: 'true' }).active).toBe('true')
    expect(normalizeQuery(ENTITY, { active: 'false' }).active).toBe('false')
    expect(normalizeQuery(ENTITY, { active: 'maybe' }).active).toBeUndefined()
  })
  it('flag: true or 1 → true, else dropped', () => {
    expect(normalizeQuery(ENTITY, { flagged: '1' }).flagged).toBe('true')
    expect(normalizeQuery(ENTITY, { flagged: 'true' }).flagged).toBe('true')
    expect(normalizeQuery(ENTITY, { flagged: '0' }).flagged).toBeUndefined()
  })
  it('text/custom: capped, blanks dropped', () => {
    const q = normalizeQuery(ENTITY, { name: '  bob  ', cust_id: '' })
    expect(q.name).toBe('bob')
    expect(q.cust_id).toBeUndefined()
  })
  it('custom entity: delegates to custom.normalize', () => {
    const e = {
      ...ENTITY,
      custom: { normalize: () => ({ x: '1' }), clauses: () => ({ conditions: [], params: [], nextIdx: 1 }) },
    }
    expect(normalizeQuery(e as unknown as FilterEntity, { foo: 'bar' })).toEqual({ x: '1' })
  })
  it('entity without search ignores the search param', () => {
    const e = { ...ENTITY, search: undefined }
    expect(normalizeQuery(e as unknown as FilterEntity, { search: 'hi' }).search).toBeUndefined()
  })
})

describe('rowsSql', () => {
  it('expr branch', () => {
    expect(rowsSql({ kind: 'values', expr: 't.c' })).toBe('SELECT btrim(t.c) AS val')
  })
  it('array branch', () => {
    expect(rowsSql({ kind: 'values', array: 't.arr' })).toBe('SELECT btrim(y) AS val FROM unnest(t.arr) y')
  })
  it('lateral with one and many exprs, UNION ALL joined', () => {
    const sql = rowsSql({ kind: 'values', lateral: { from: 'lk l', link: 'l.id = t.id', expr: ['l.a', 'l.b'] } })
    expect(sql).toBe('SELECT btrim(l.a) AS val FROM lk l WHERE l.id = t.id UNION ALL SELECT btrim(l.b) AS val FROM lk l WHERE l.id = t.id')
  })
  it('combines all three with UNION ALL', () => {
    const sql = rowsSql({ kind: 'values', expr: 't.c', array: 't.arr', lateral: { from: 'f', link: 'k', expr: 'e' } })
    expect(sql.split(' UNION ALL ')).toHaveLength(3)
  })
})

describe('buildClauses — field conditions', () => {
  const bc = (q: Record<string, string>, opts = {}) => buildClauses(ENTITY, q, 1, opts)

  it('enum: real IN with cast + EXISTS wrapper, plus virtual OR', () => {
    const r = bc({ kind: 'done|special' })
    expect(r.conditions[0]).toBe(
      '(EXISTS (SELECT 1 FROM tags g WHERE g.tid = t.id AND t.kind IN ($1::kind_type)) OR (t.special = true))'
    )
    expect(r.params).toEqual(['done'])
  })
  it('enum: plain IN without cast/exists', () => {
    const r = bc({ status: 'open|done' })
    expect(r.conditions).toEqual(['t.status IN ($1, $2)'])
    expect(r.params).toEqual(['open', 'done'])
  })
  it('enum: single real value is not parenthesised', () => {
    const r = bc({ status: 'open' })
    expect(r.conditions).toEqual(['t.status IN ($1)'])
  })
  it('enum: empty value → no condition', () => {
    expect(bc({ status: '' }).conditions).toEqual([])
  })
  it('enum: only-virtual value', () => {
    const r = bc({ kind: 'special' })
    expect(r.conditions).toEqual(['(t.special = true)'])
    expect(r.params).toEqual([])
  })
  it('values: matchValues expr IN', () => {
    const r = bc({ tags: 'a|b' })
    expect(r.conditions).toEqual(['lower(btrim(t.tag)) IN (lower($1), lower($2))'])
    expect(r.params).toEqual(['a', 'b'])
  })
  it('values: empty → nothing', () => {
    expect(bc({ tags: '' }).conditions).toEqual([])
  })
  it('range: both bounds', () => {
    const r = bc({ amount_min: '5', amount_max: '9' })
    expect(r.conditions).toEqual(['t.amt >= $1::numeric', 't.amt <= $2::numeric'])
    expect(r.params).toEqual(['5', '9'])
  })
  it('range: only min', () => {
    expect(bc({ amount_min: '5' }).conditions).toEqual(['t.amt >= $1::numeric'])
  })
  it('date: timestamp mode uses IST bounds', () => {
    const r = bc({ from: '2026-01-01', to: '2026-02-01' })
    expect(r.conditions[0]).toContain('t.created_at >= ')
    expect(r.conditions[0]).toContain("AT TIME ZONE 'Asia/Kolkata'")
    expect(r.conditions[1]).toContain('t.created_at < ')
  })
  it('date: dateOnly mode casts to date', () => {
    const r = bc({ due_from: '2026-01-01', due_to: '2026-02-01' })
    expect(r.conditions).toEqual(['t.due_on >= $1::date', 't.due_on <= $2::date'])
  })
  it('bool true/false/unset', () => {
    expect(bc({ active: 'true' }).conditions).toEqual(['(t.active)'])
    expect(bc({ active: 'false' }).conditions).toEqual(['NOT (t.active)'])
    expect(bc({ active: 'x' }).conditions).toEqual([])
  })
  it('flag: true only', () => {
    expect(bc({ flagged: 'true' }).conditions).toEqual(['(t.flagged)'])
    expect(bc({ flagged: 'false' }).conditions).toEqual([])
  })
  it('text: contains (default)', () => {
    const r = bc({ name: 'ab' })
    expect(r.conditions).toEqual(["t.name ILIKE '%' || $1 || '%'"])
    expect(r.params).toEqual(['ab'])
  })
  it('text: empty → nothing', () => {
    expect(bc({ name: '' }).conditions).toEqual([])
  })
  it('custom: builds when set, nothing when unset', () => {
    expect(bc({ cust_id: 'c1' }).conditions).toEqual(['t.cid = $1'])
    expect(bc({}).conditions).toEqual([])
  })

  it('text exact + prefix + multi-expr', () => {
    const e = {
      ...ENTITY,
      fields: defineFields({ ex: { label: 'E', type: 'text' }, pf: { label: 'P', type: 'text' }, mm: { label: 'M', type: 'text' } }),
      sql: {
        ex: { kind: 'text', expr: 't.a', match: 'exact' } as FieldSql,
        pf: { kind: 'text', expr: 't.b', match: 'prefix' } as FieldSql,
        mm: { kind: 'text', expr: ['t.c', 't.d'] } as FieldSql,
      },
    } as unknown as FilterEntity
    expect(buildClauses(e, { ex: 'x' }, 1).conditions).toEqual(['lower(t.a) = lower($1)'])
    expect(buildClauses(e, { pf: 'y' }, 1).conditions).toEqual(["t.b ILIKE $1 || '%'"])
    expect(buildClauses(e, { mm: 'z' }, 1).conditions).toEqual(["(t.c ILIKE '%' || $1 || '%' OR t.d ILIKE '%' || $1 || '%')"])
  })

  it('values: array + lateral matchValues forms OR', () => {
    const e = {
      ...ENTITY,
      fields: defineFields({ v: { label: 'V', type: 'value-help' } }),
      sql: { v: { kind: 'values', array: 't.arr', lateral: { from: 'lk l', link: 'l.id=t.id', expr: ['l.a', 'l.b'] }, fold: 'upper' } as FieldSql },
    } as unknown as FilterEntity
    const r = buildClauses(e, { v: 'x' }, 1)
    expect(r.conditions[0]).toContain('upper(')
    expect(r.conditions[0]).toContain('EXISTS (SELECT 1 FROM unnest(t.arr)')
    expect(r.conditions[0]).toContain("EXISTS (SELECT 1 FROM lk l WHERE l.id=t.id AND (upper(btrim(l.a)) IN (upper($1)) OR upper(btrim(l.b)) IN (upper($1))))")
  })

  it('respects omit and only', () => {
    expect(buildClauses(ENTITY, { status: 'open', name: 'x' }, 1, { omit: ['status'] }).conditions).toEqual(["t.name ILIKE '%' || $1 || '%'"])
    expect(buildClauses(ENTITY, { status: 'open', name: 'x' }, 1, { only: ['status'] }).conditions).toEqual(['t.status IN ($1)'])
  })

  it('custom entity: delegates clauses (and respects only→empty)', () => {
    const custom = { normalize: () => ({}), clauses: (_q: unknown, s: number) => ({ conditions: ['c.x = 1'], params: ['p'], nextIdx: s + 1 }) }
    const e = { ...ENTITY, custom } as unknown as FilterEntity
    expect(buildClauses(e, {}, 5).conditions).toEqual(['c.x = 1'])
    expect(buildClauses(e, {}, 5, { only: ['x'] }).conditions).toEqual([])
  })

  it('branch opt delegates to branchOf', () => {
    expect(buildClauses(UNION, { status: 'open' }, 1, { branch: 'a' }).conditions).toEqual(['a.status IN ($1)'])
  })
})

// A UNION entity with two branches for union-path coverage.
const BRANCHES: [FilterBranch<'status'>, FilterBranch<'status'>] = [
  { key: 'a', root: 'ta', alias: 'a', base: ['a.ok'], sql: { status: { kind: 'enum', expr: 'a.status' } }, search: (q, i) => ({ clause: `a.n ILIKE $${i}`, params: [q], nextIdx: i + 1 }), export: { columns: { label: 'a.label' }, keyset: ['a.at', 'a.id'] } },
  { key: 'b', root: 'tb', alias: 'b', pk: 'bid', sql: { status: { kind: 'enum', expr: 'b.status' } } },
]
const UNION = unionEntity<'status'>({
  key: 'u',
  scope: 'u:read',
  noun: 'U',
  fields: defineFields({ status: { label: 'S', type: 'multi-select' } }),
  search: { param: 'search' },
  export: { columns: [{ key: 'label', label: 'L', sql: 'NULL' }], keyset: ['at', 'id'] },
  branches: BRANCHES,
})

describe('unionEntity / branchesOf / branchOf / branchView', () => {
  it('top-level mirrors the first branch', () => {
    expect(UNION.root).toBe('ta')
    expect(UNION.alias).toBe('a')
    expect(UNION.base).toEqual(['a.ok'])
  })
  it('branchesOf returns one view per branch', () => {
    const views = branchesOf(UNION)
    expect(views.map(v => v.alias)).toEqual(['a', 'b'])
    expect(views[1].pk).toBe('bid')
    // second branch has no export → columns mapped to NULL
    expect(views[1].export?.columns[0].sql).toBe('NULL')
    expect(views[0].export?.columns[0].sql).toBe('a.label')
  })
  it('branchesOf on a plain entity returns [itself]', () => {
    expect(branchesOf(ENTITY)).toEqual([ENTITY])
  })
  it('branchOf finds a named branch, else the entity', () => {
    expect(branchOf(UNION, 'b').alias).toBe('b')
    expect(branchOf(UNION, 'missing')).toBe(UNION)
    expect(branchOf(UNION)).toBe(UNION)
  })
  it('branch without its own search gets the NO_MATCH builder (FALSE)', () => {
    const w = buildWhere(UNION, { search: 'hi' }, 1, { branch: 'b' })
    expect(w.conditions).toContain('FALSE')
  })
})

describe('buildWhere', () => {
  it('base + search + fields, numbered sequentially', () => {
    const w = buildWhere(ENTITY, { search: 'hi', status: 'open' }, 1)
    expect(w.where).toBe('WHERE t.deleted = false AND t.name ILIKE $1 AND t.status IN ($2)')
    expect(w.params).toEqual(['%hi%', 'open'])
  })
  it('base:false drops base conditions', () => {
    const w = buildWhere(ENTITY, { status: 'open' }, 1, { base: false })
    expect(w.where).toBe('WHERE t.status IN ($1)')
  })
  it('empty query with base:false → no WHERE', () => {
    expect(buildWhere(ENTITY, {}, 1, { base: false }).where).toBe('')
  })
  it('search skipped when omitted', () => {
    const w = buildWhere(ENTITY, { search: 'hi' }, 1, { omit: ['search'] })
    expect(w.where).toBe('WHERE t.deleted = false')
  })
  it('search skipped when only is set', () => {
    const w = buildWhere(ENTITY, { search: 'hi', status: 'open' }, 1, { only: ['status'] })
    expect(w.where).toBe('WHERE t.deleted = false AND t.status IN ($1)')
  })
  it('boundBase conditions always applied and numbered', () => {
    const e = { ...ENTITY, boundBase: [(_ctx: unknown, bind: (v: unknown) => string) => `t.tenant = ${bind('T1')}`] }
    const w = buildWhere(e as unknown as FilterEntity, { status: 'open' }, 1)
    expect(w.where).toBe('WHERE t.deleted = false AND t.tenant = $1 AND t.status IN ($2)')
    expect(w.params).toEqual(['T1', 'open'])
  })
  it('branch opt delegates', () => {
    const w = buildWhere(UNION, { status: 'open' }, 1, { branch: 'b' })
    expect(w.where).toContain('b.status IN ($1)')
  })
})

describe('hasFilters', () => {
  it('true when search set', () => {
    expect(hasFilters(ENTITY, { search: 'hi' })).toBe(true)
  })
  it('false when search omitted', () => {
    expect(hasFilters(ENTITY, { search: 'hi' }, ['search'])).toBe(false)
  })
  it('true when a field param set, respects omit', () => {
    expect(hasFilters(ENTITY, { status: 'open' })).toBe(true)
    expect(hasFilters(ENTITY, { status: 'open' }, ['status'])).toBe(false)
  })
  it('false when nothing set', () => {
    expect(hasFilters(ENTITY, {})).toBe(false)
  })
  it('custom entity delegates to clauses', () => {
    const e = { ...ENTITY, custom: { normalize: () => ({}), clauses: () => ({ conditions: ['x'], params: [], nextIdx: 1 }) } }
    expect(hasFilters(e as unknown as FilterEntity, {})).toBe(true)
  })
})

describe('filterScope', () => {
  it('empty scope yields empty sql', () => {
    const s = filterScope(ENTITY, {})
    expect(s.empty).toBe(true)
    expect(s.and(5)).toEqual({ sql: '', params: [] })
    expect(s.inIds('x.id', 5)).toEqual({ sql: '', params: [] })
  })
  it('and() appends AND-prefixed fragments from startIdx', () => {
    const s = filterScope(ENTITY, { status: 'open' })
    expect(s.empty).toBe(false)
    const r = s.and(3)
    expect(r.sql).toBe(' AND t.status IN ($3)')
    expect(r.params).toEqual(['open'])
  })
  it('inIds() builds a UNION-ALL id subquery over branches', () => {
    const s = filterScope(UNION, { status: 'open' })
    const r = s.inIds('p.id', 1)
    expect(r.sql).toContain(' AND p.id IN (')
    expect(r.sql).toContain('SELECT a.id FROM ta a')
    expect(r.sql).toContain('SELECT b.bid FROM tb b')
    expect(r.sql).toContain('UNION ALL')
    expect(r.params).toEqual(['open', 'open'])
  })
  it('and() with explicit branch', () => {
    const s = filterScope(UNION, { status: 'open' })
    expect(s.and(1, 'b').sql).toContain('b.status IN ($1)')
  })
})

describe('countQuery', () => {
  it('single entity count with cap+1', () => {
    const { sql, params } = countQuery(ENTITY, { status: 'open' }, 100)
    expect(sql).toContain('SELECT count(*)::int AS n FROM (')
    expect(sql).toContain('SELECT 1 FROM things t WHERE')
    expect(sql).toContain('LIMIT 101')
    expect(params).toEqual(['open'])
  })
  it('union count merges branches', () => {
    const { sql, params } = countQuery(UNION, { status: 'open' }, 10)
    expect(sql).toContain('SELECT 1 FROM ta a')
    expect(sql).toContain('SELECT 1 FROM tb b')
    expect(sql).toContain('UNION ALL')
    expect(params).toEqual(['open', 'open'])
  })
})
