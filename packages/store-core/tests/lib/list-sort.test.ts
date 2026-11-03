import { describe, it, expect } from 'vitest'
import { orderByClause, parseSort, sortClause, type SortDef } from '@jeffi/list-filters'

const def: SortDef = {
  sorts: { date: 'o.created_at', total: 'o.total_amount' },
  defaultSql: 'o.created_at DESC',
  tiebreak: 'o.id DESC',
}
const q = (s: string) => new URLSearchParams(s)

describe('list sort', () => {
  it('parses a whitelisted key and normalises dir', () => {
    expect(parseSort(q('sort=total&dir=ASC'), def.sorts)).toEqual({ key: 'total', dir: 'asc' })
    expect(parseSort(q('sort=total&dir=sideways'), def.sorts)).toEqual({ key: 'total', dir: 'desc' })
    expect(parseSort(q('sort=total&order=asc'), def.sorts)).toEqual({ key: 'total', dir: 'asc' })
  })

  it('ignores unknown and prototype keys', () => {
    expect(parseSort(q('sort=nope'), def.sorts)).toBeNull()
    expect(parseSort(q('sort=constructor'), def.sorts)).toBeNull()
    expect(parseSort(q(''), def.sorts)).toBeNull()
  })

  it('builds ORDER BY with the tie-breaker', () => {
    expect(orderByClause(def, { key: 'total', dir: 'asc' })).toBe('ORDER BY o.total_amount ASC NULLS LAST, o.id DESC')
    expect(orderByClause(def, null)).toBe('ORDER BY o.created_at DESC, o.id DESC')
    expect(sortClause(q('sort=__proto__&dir=asc'), def)).toBe('ORDER BY o.created_at DESC, o.id DESC')
  })
})
