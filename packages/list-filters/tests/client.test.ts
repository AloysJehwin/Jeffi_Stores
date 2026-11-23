import { describe, it, expect } from 'vitest'
import {
  toParams,
  splitFilterValues,
  joinFilterValues,
  escapeLike,
  defaultParamNames,
  paramNamesOf,
  defineFields,
  normalizeParams,
  canonicalQuery,
  activeCount,
  listParamNames,
  VALUE_SEPARATOR,
} from '../src/client'

describe('toParams', () => {
  it('clones a URLSearchParams', () => {
    const sp = new URLSearchParams('a=1&b=2')
    const out = toParams(sp)
    expect(out).not.toBe(sp)
    expect(out.get('a')).toBe('1')
    expect(out.get('b')).toBe('2')
  })

  it('accepts a get/toString-shaped source', () => {
    const src = { get: (n: string) => (n === 'x' ? 'y' : null), toString: () => 'x=y' }
    expect(toParams(src).get('x')).toBe('y')
  })

  it('builds from a plain record, taking the first of arrays and skipping empty/null', () => {
    const out = toParams({ a: '1', b: ['2', '3'], c: 4, d: undefined, e: null, f: '' })
    expect(out.get('a')).toBe('1')
    expect(out.get('b')).toBe('2')
    expect(out.get('c')).toBe('4')
    expect(out.has('d')).toBe(false)
    expect(out.has('e')).toBe(false)
    expect(out.has('f')).toBe(false)
  })

  it('skips an array whose first element is empty', () => {
    const out = toParams({ a: [''] })
    expect(out.has('a')).toBe(false)
  })
})

describe('splitFilterValues', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(splitFilterValues(null)).toEqual([])
    expect(splitFilterValues(undefined)).toEqual([])
    expect(splitFilterValues('')).toEqual([])
  })

  it('splits on the pipe and dedupes/trims', () => {
    expect(splitFilterValues(' a | b | a ')).toEqual(['a', 'b'])
  })

  it('does not split on commas by default', () => {
    expect(splitFilterValues('a,b')).toEqual(['a,b'])
  })

  it('splits on commas when opts.commas', () => {
    expect(splitFilterValues('a,b|c', { commas: true })).toEqual(['a', 'b', 'c'])
  })

  it('flattens an array input', () => {
    expect(splitFilterValues(['a|b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('joinFilterValues', () => {
  it('pipe-joins', () => {
    expect(joinFilterValues(['a', 'b'])).toBe(`a${VALUE_SEPARATOR}b`)
  })
})

describe('escapeLike', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
  })

  it('leaves a clean string untouched', () => {
    expect(escapeLike('abc')).toBe('abc')
  })
})

describe('defaultParamNames', () => {
  it('range → _min/_max', () => {
    expect(defaultParamNames('amt', 'range')).toEqual(['amt_min', 'amt_max'])
  })
  it('date-range → _from/_to', () => {
    expect(defaultParamNames('d', 'date-range')).toEqual(['d_from', 'd_to'])
  })
  it('other → the key', () => {
    expect(defaultParamNames('status', 'select')).toBe('status')
  })
})

describe('paramNamesOf', () => {
  it('wraps a single name', () => {
    expect(paramNamesOf({ name: 'a', label: '', type: 'text' })).toEqual(['a'])
  })
  it('passes a tuple through', () => {
    expect(paramNamesOf({ name: ['a', 'b'], label: '', type: 'range' })).toEqual(['a', 'b'])
  })
})

describe('defineFields', () => {
  it('keeps insertion order and keys, defaulting names', () => {
    const fields = defineFields({
      status: { label: 'Status', type: 'select' },
      amt: { label: 'Amount', type: 'range' },
      named: { label: 'N', type: 'text', name: 'custom' },
    })
    expect(fields.map(f => f.key)).toEqual(['status', 'amt', 'named'])
    expect(fields[0].name).toBe('status')
    expect(fields[1].name).toEqual(['amt_min', 'amt_max'])
    expect(fields[2].name).toBe('custom')
  })
})

const sp = (s: string) => new URLSearchParams(s)

describe('normalizeParams', () => {
  it('no aliases → unchanged', () => {
    const { params, changed } = normalizeParams(sp('a=1'))
    expect(changed).toBe(false)
    expect(params.get('a')).toBe('1')
  })

  it('renames a param when the source has it and target is empty', () => {
    const { params, changed } = normalizeParams(sp('old=x'), [{ param: 'old', to: 'new' }])
    expect(changed).toBe(true)
    expect(params.has('old')).toBe(false)
    expect(params.get('new')).toBe('x')
  })

  it('rename keeps an existing target value', () => {
    const { params } = normalizeParams(sp('old=x&new=y'), [{ param: 'old', to: 'new' }])
    expect(params.get('new')).toBe('y')
    expect(params.has('old')).toBe(false)
  })

  it('skips an alias whose param is absent', () => {
    const { params, changed } = normalizeParams(sp('a=1'), [{ param: 'old', to: 'new' }])
    expect(changed).toBe(false)
    expect(params.has('new')).toBe(false)
  })

  it('value-move: moves only the matching value, leaving the rest', () => {
    const { params, changed } = normalizeParams(sp('src=a,b&dst=z'), [{ param: 'src', to: 'dst', value: 'a' }])
    expect(changed).toBe(true)
    expect(splitFilterValues(params.get('src'), { commas: true })).toEqual(['b'])
    expect(splitFilterValues(params.get('dst'), { commas: true }).sort()).toEqual(['a', 'z'])
  })

  it('value-move: deletes the source param when nothing is left', () => {
    const { params } = normalizeParams(sp('src=a'), [{ param: 'src', to: 'dst', value: 'a' }])
    expect(params.has('src')).toBe(false)
    expect(params.get('dst')).toBe('a')
  })

  it('value-move: uses `set` as the target value', () => {
    const { params } = normalizeParams(sp('src=a'), [{ param: 'src', to: 'dst', value: 'a', set: 'A' }])
    expect(params.get('dst')).toBe('A')
  })

  it('value-move: skips when the value is not present', () => {
    const { params, changed } = normalizeParams(sp('src=b'), [{ param: 'src', to: 'dst', value: 'a' }])
    expect(changed).toBe(false)
    expect(params.get('src')).toBe('b')
  })
})

describe('canonicalQuery', () => {
  const fields = defineFields({
    status: { label: 'S', type: 'select' },
    tags: { label: 'T', type: 'multi-select' },
    help: { label: 'H', type: 'value-help' },
  })

  it('keeps search (trimmed) then fields in order', () => {
    const out = canonicalQuery(sp('search= hi &status=open&tags=a,b'), fields)
    const p = new URLSearchParams(out)
    expect(p.get('search')).toBe('hi')
    expect(p.get('status')).toBe('open')
    expect(p.get('tags')).toBe(`a${VALUE_SEPARATOR}b`)
  })

  it('value-help field does not comma-split', () => {
    const out = canonicalQuery(sp('help=a,b'), fields)
    expect(new URLSearchParams(out).get('help')).toBe('a,b')
  })

  it('omits named params and respects search=false', () => {
    const out = canonicalQuery(sp('search=hi&status=open'), fields, { search: false, omit: ['status'] })
    expect(out).toBe('')
  })

  it('custom search param name', () => {
    const out = canonicalQuery(sp('q=hi'), fields, { search: 'q' })
    expect(new URLSearchParams(out).get('q')).toBe('hi')
  })

  it('skips a blank search and missing/blank field values', () => {
    const out = canonicalQuery(sp('search=   &status='), fields)
    expect(out).toBe('')
  })

  it('omits the search param when it is in omit', () => {
    const out = canonicalQuery(sp('search=hi'), fields, { omit: ['search'] })
    expect(out).toBe('')
  })

  it('drops a multi value that reduces to empty', () => {
    const out = canonicalQuery(sp('tags= '), fields)
    expect(out).toBe('')
  })
})

describe('activeCount', () => {
  const fields = defineFields({
    a: { label: 'A', type: 'text' },
    r: { label: 'R', type: 'range' },
  })
  it('counts fields with any set param', () => {
    expect(activeCount(sp('a=1'), fields)).toBe(1)
    expect(activeCount(sp('r_min=5'), fields)).toBe(1)
    expect(activeCount(sp('a=1&r_max=9'), fields)).toBe(2)
    expect(activeCount(sp('x=1'), fields)).toBe(0)
  })
})

describe('listParamNames', () => {
  const fields = defineFields({
    a: { label: 'A', type: 'text' },
    r: { label: 'R', type: 'range' },
  })
  it('fields + search + alias params, deduped', () => {
    expect(listParamNames(fields)).toEqual(['a', 'r_min', 'r_max', 'search'])
  })
  it('omits search when search=false, adds alias params', () => {
    expect(listParamNames(fields, { search: false, aliases: [{ param: 'old', to: 'a' }] })).toEqual([
      'a',
      'r_min',
      'r_max',
      'old',
    ])
  })
  it('custom search param', () => {
    expect(listParamNames(fields, { search: 'q' })).toContain('q')
  })
})
