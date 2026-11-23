import { describe, it, expect } from 'vitest'
import {
  PRODUCT_SORTS,
  DEFAULT_PRODUCT_SORT,
  PRODUCT_TABLE_COLUMNS,
  normalizeProductSort,
  productSortKey,
  productSortOption,
  tableSortState,
  nextTableSort,
} from '../src/product-sort'

describe('normalizeProductSort', () => {
  it('maps aliases and lowercases/trims', () => {
    expect(normalizeProductSort(' Base_Price ')).toBe('price')
    expect(normalizeProductSort('newest')).toBe('created_at')
    expect(normalizeProductSort('popular')).toBe('') // alias → ''
    expect(normalizeProductSort('featured')).toBe('')
  })
  it('passes through a non-alias key', () => {
    expect(normalizeProductSort('name')).toBe('name')
    expect(normalizeProductSort('price')).toBe('price')
  })
  it('treats null/undefined/empty as ""', () => {
    expect(normalizeProductSort(null)).toBe('')
    expect(normalizeProductSort(undefined)).toBe('')
    expect(normalizeProductSort('')).toBe('')
  })
})

describe('productSortKey', () => {
  it('returns featured for empty/unknown/alias keys', () => {
    expect(productSortKey(null)).toBe('featured')
    expect(productSortKey('popular')).toBe('featured') // alias → '' → default
    expect(productSortKey('bogus')).toBe('featured') // not in DEFAULT_DIR
  })
  it('honours an explicit asc/desc', () => {
    expect(productSortKey('price', 'asc')).toBe('price_asc')
    expect(productSortKey('price', 'DESC')).toBe('price_desc') // case-insensitive
  })
  it('uses the per-key default direction when dir is absent/garbage', () => {
    expect(productSortKey('price')).toBe('price_asc') // DEFAULT_DIR.price = asc
    expect(productSortKey('created_at')).toBe('newest') // DEFAULT_DIR.created_at = desc
    expect(productSortKey('price', 'sideways')).toBe('price_asc') // garbage dir → default
  })
  it('falls back to the sort-only option when no dir matches', () => {
    // name only has an asc option; asking for desc still resolves to the name option.
    expect(productSortKey('name', 'desc')).toBe('name_asc')
  })
  it('resolves created_at ascending has no option → sort-only fallback', () => {
    // No price_desc-style asc option exists for created_at, only newest(desc).
    expect(productSortKey('created_at', 'asc')).toBe('newest')
  })
})

describe('productSortOption', () => {
  it('finds by id', () => {
    expect(productSortOption('price_desc')).toEqual(PRODUCT_SORTS.find(o => o.id === 'price_desc'))
  })
  it('falls back to the first option (featured) for unknown/null', () => {
    expect(productSortOption('nope')).toBe(PRODUCT_SORTS[0])
    expect(productSortOption(null)).toBe(PRODUCT_SORTS[0])
    expect(productSortOption(undefined)).toBe(PRODUCT_SORTS[0])
    expect(DEFAULT_PRODUCT_SORT).toBe('featured')
  })
})

describe('tableSortState', () => {
  it('returns null when the list is not sorted by this column', () => {
    expect(tableSortState('price', 'name', 'asc')).toBeNull()
    expect(tableSortState('name', null, null)).toBeNull() // normalize('') !== 'name'
  })
  it('returns the explicit asc/desc when provided', () => {
    expect(tableSortState('price', 'price', 'desc')).toBe('desc')
    expect(tableSortState('price', 'base_price', 'ASC')).toBe('asc') // alias normalises to price
  })
  it("falls back to the column's natural direction when dir is garbage", () => {
    expect(tableSortState('stock', 'stock', 'junk')).toBe('desc') // stock natural = desc
    expect(tableSortState('name', 'name', undefined)).toBe('asc') // name natural = asc
  })
  it("defaults to 'asc' when the key is not a known column", () => {
    // normalize('discount')==='discount' matches key, but no column lookup match path for unknown keys:
    // use a key present in neither columns to hit the col?.dir ?? 'asc' else.
    expect(tableSortState('created_at', 'created_at', 'bad')).toBe('asc')
  })
})

describe('nextTableSort', () => {
  it('returns {} for an unknown column', () => {
    expect(nextTableSort('bogus' as any, 'name', 'asc')).toEqual({})
  })
  it('first click: applies the natural direction when unsorted', () => {
    expect(nextTableSort('name', null, null)).toEqual({ sort: 'name', dir: 'asc' })
    expect(nextTableSort('stock', null, null)).toEqual({ sort: 'stock', dir: 'desc' })
  })
  it('second click: flips the direction', () => {
    expect(nextTableSort('name', 'name', 'asc')).toEqual({ sort: 'name', dir: 'desc' })
    expect(nextTableSort('stock', 'stock', 'desc')).toEqual({ sort: 'stock', dir: 'asc' })
  })
  it('third click: clears back to featured', () => {
    // state is the flipped (non-natural) direction → {}
    expect(nextTableSort('name', 'name', 'desc')).toEqual({})
    expect(nextTableSort('stock', 'stock', 'asc')).toEqual({})
  })
})

describe('catalog shape', () => {
  it('PRODUCT_SORTS has the five known ids in order', () => {
    expect(PRODUCT_SORTS.map(o => o.id)).toEqual(['featured', 'newest', 'price_asc', 'price_desc', 'name_asc'])
  })
  it('PRODUCT_TABLE_COLUMNS has the four columns with natural directions', () => {
    expect(PRODUCT_TABLE_COLUMNS).toEqual([
      { key: 'name', label: 'Product', dir: 'asc' },
      { key: 'price', label: 'Price', dir: 'asc' },
      { key: 'discount', label: 'Off', dir: 'desc' },
      { key: 'stock', label: 'Stock', dir: 'desc' },
    ])
  })
})
