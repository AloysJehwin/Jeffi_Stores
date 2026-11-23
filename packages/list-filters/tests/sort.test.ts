import { describe, it, expect } from 'vitest'
import { normalizeDir, parseSort, orderByClause, sortClause, type SortDef } from '../src/sort'

const def: SortDef = {
  sorts: { name: 'o.name', total: 'o.total' },
  defaultSql: 'o.created_at DESC',
  tiebreak: 'o.id',
}

describe('normalizeDir', () => {
  it('accepts asc/desc case-insensitively', () => {
    expect(normalizeDir('asc')).toBe('asc')
    expect(normalizeDir('DESC')).toBe('desc')
  })
  it('falls back for unknown/empty input', () => {
    expect(normalizeDir('bogus')).toBe('desc')
    expect(normalizeDir(null)).toBe('desc')
    expect(normalizeDir(undefined)).toBe('desc')
  })
  it('honours a custom fallback', () => {
    expect(normalizeDir('', 'asc')).toBe('asc')
  })
})

describe('parseSort', () => {
  it('null when no sort key', () => {
    expect(parseSort(new URLSearchParams(''), def.sorts)).toBeNull()
  })
  it('null when sorts map missing', () => {
    expect(parseSort(new URLSearchParams('sort=name'), undefined)).toBeNull()
  })
  it('null for an unknown key', () => {
    expect(parseSort(new URLSearchParams('sort=nope'), def.sorts)).toBeNull()
  })
  it('reads dir', () => {
    expect(parseSort(new URLSearchParams('sort=name&dir=asc'), def.sorts)).toEqual({ key: 'name', dir: 'asc' })
  })
  it('accepts order as an alias for dir', () => {
    expect(parseSort(new URLSearchParams('sort=name&order=asc'), def.sorts)).toEqual({ key: 'name', dir: 'asc' })
  })
  it('defaults dir to desc', () => {
    expect(parseSort(new URLSearchParams('sort=total'), def.sorts)).toEqual({ key: 'total', dir: 'desc' })
  })
})

describe('orderByClause', () => {
  it('uses default + tiebreak when spec is null', () => {
    expect(orderByClause(def, null)).toBe('ORDER BY o.created_at DESC, o.id')
  })
  it('asc spec maps to ASC NULLS LAST', () => {
    expect(orderByClause(def, { key: 'name', dir: 'asc' })).toBe('ORDER BY o.name ASC NULLS LAST, o.id')
  })
  it('desc spec maps to DESC NULLS LAST', () => {
    expect(orderByClause(def, { key: 'total', dir: 'desc' })).toBe('ORDER BY o.total DESC NULLS LAST, o.id')
  })
  it('spec with unknown key falls back to default', () => {
    expect(orderByClause(def, { key: 'ghost', dir: 'asc' })).toBe('ORDER BY o.created_at DESC, o.id')
  })
  it('omits tiebreak when not defined', () => {
    expect(orderByClause({ sorts: {}, defaultSql: 'x DESC' }, null)).toBe('ORDER BY x DESC')
  })
})

describe('sortClause', () => {
  it('parses and builds in one step', () => {
    expect(sortClause(new URLSearchParams('sort=name&dir=asc'), def)).toBe('ORDER BY o.name ASC NULLS LAST, o.id')
  })
  it('default when nothing picked', () => {
    expect(sortClause(new URLSearchParams(''), def)).toBe('ORDER BY o.created_at DESC, o.id')
  })
})
