import { describe, it, expect } from 'vitest'
import { exportQuery, EXPORT_BATCH } from '../src/export'
import { defineFields } from '../src/client'
import { unionEntity } from '../src/clauses'
import type { FieldSql, FilterEntity, FilterBranch } from '../src/types'

const FIELDS = defineFields({
  status: { label: 'Status', type: 'multi-select' },
  created: { name: ['from', 'to'], label: 'Created', type: 'date-range' },
})
type K = (typeof FIELDS)[number]['key']
const SQL: Record<K, FieldSql> = {
  status: { kind: 'enum', expr: 't.status' },
  created: { kind: 'date', expr: 't.created_at' },
}
const base: FilterEntity<K> = {
  key: 'things', scope: 's', noun: 'N', root: 'things', alias: 't', fields: FIELDS, sql: SQL, period: 'created',
}

describe('exportQuery — single entity', () => {
  const e: FilterEntity<K> = {
    ...base,
    export: { columns: [{ key: 'name', label: 'Name', sql: 't.name' }], keyset: ['t.created_at', 't.id'] },
  }

  it('null when no export', () => {
    expect(exportQuery(base, {})).toBeNull()
  })
  it('null when no columns or no keyset', () => {
    expect(exportQuery({ ...base, export: { columns: [], keyset: ['t.id'] } }, {})).toBeNull()
    expect(exportQuery({ ...base, export: { columns: [{ key: 'n', label: 'N', sql: 't.n' }], keyset: [] } }, {})).toBeNull()
  })

  it('builds SELECT with aliased columns, keyset text cols, ORDER BY and LIMIT', () => {
    const r = exportQuery(e, {})
    expect(r).not.toBeNull()
    expect(r!.sql).toContain('SELECT t.name AS "name", (t.created_at)::text AS "__k0", (t.id)::text AS "__k1"')
    expect(r!.sql).toContain('FROM things t')
    expect(r!.sql).toContain('ORDER BY t.created_at, t.id')
    expect(r!.sql).toContain(`LIMIT ${EXPORT_BATCH}`)
  })

  it('includes a WHERE when filters are present', () => {
    const r = exportQuery(e, { status: 'open' })
    expect(r!.sql).toContain('WHERE t.status IN ($1)')
    expect(r!.params).toEqual(['open'])
  })

  it('keyset `after` of the right length adds a tuple comparison', () => {
    const r = exportQuery(e, {}, { after: ['2026-01-01', 'uuid-1'] })
    expect(r!.sql).toContain('(t.created_at, t.id) > ($1, $2)')
    expect(r!.params).toEqual(['2026-01-01', 'uuid-1'])
  })

  it('ignores an `after` of the wrong length', () => {
    const r = exportQuery(e, {}, { after: ['only-one'] })
    expect(r!.sql).not.toContain('> (')
  })

  it('custom limit, floored at 1', () => {
    expect(exportQuery(e, {}, { limit: 25 })!.sql).toContain('LIMIT 25')
    expect(exportQuery(e, {}, { limit: 0 })!.sql).toContain('LIMIT 1')
  })
})

describe('exportQuery — union entity', () => {
  const BR: [FilterBranch<'status'>, FilterBranch<'status'>] = [
    { key: 'a', root: 'ta', alias: 'a', sql: { status: { kind: 'enum', expr: 'a.status' } }, export: { columns: { name: 'a.name' }, keyset: ['a.at', 'a.id'] } },
    { key: 'b', root: 'tb', alias: 'b', sql: { status: { kind: 'enum', expr: 'b.status' } } },
  ]
  const U = unionEntity<'status'>({
    key: 'u', scope: 's', noun: 'N',
    fields: defineFields({ status: { label: 'S', type: 'multi-select' } }),
    export: { columns: [{ key: 'name', label: 'N', sql: 'NULL' }], keyset: ['at', 'id'] },
    branches: BR,
  })

  it('merges per-branch SELECTs with UNION ALL, output-key ORDER BY', () => {
    const r = exportQuery(U, {})
    expect(r).not.toBeNull()
    expect(r!.sql).toContain('SELECT a.name AS "name", a.at AS "__k0", a.id AS "__k1" FROM ta a')
    // branch b has no export → NULL columns + empty keyset
    expect(r!.sql).toContain('FROM tb b')
    expect(r!.sql).toContain('UNION ALL')
    expect(r!.sql).toContain('ORDER BY "__k0", "__k1"')
  })

  it('applies filters and keyset after per branch', () => {
    const r = exportQuery(U, { status: 'open' }, { after: ['2026', 'x'] })
    // branch a keyset length 2 matches after → tuple comparison bound
    expect(r!.sql).toContain('(a.at, a.id) > (')
    expect(r!.params).toContain('open')
    expect(r!.params).toContain('2026')
  })
})
