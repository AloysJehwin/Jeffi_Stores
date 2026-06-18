import { describe, it, expect } from 'vitest'

import { sortOptions } from '@/components/admin/sortOptions'

describe('sortOptions', () => {
  it('returns text options for type "text"', () => {
    const opts = sortOptions('text')
    expect(opts).toHaveLength(2)
    expect(opts[0].value).toBe('asc')
    expect(opts[1].value).toBe('desc')
  })

  it('text ascending label contains A and Z', () => {
    const opts = sortOptions('text')
    expect(opts[0].label).toMatch(/A/)
    expect(opts[0].label).toMatch(/Z/)
  })

  it('returns numeric options for type "number"', () => {
    const opts = sortOptions('number')
    expect(opts).toHaveLength(2)
    expect(opts[0].label).toMatch(/Low/i)
    expect(opts[1].label).toMatch(/High/i)
  })

  it('numeric ascending is Low → High', () => {
    const opts = sortOptions('number')
    expect(opts[0].value).toBe('asc')
    expect(opts[1].value).toBe('desc')
  })

  it('returns date options for type "date"', () => {
    const opts = sortOptions('date')
    expect(opts).toHaveLength(2)
    expect(opts[0].label).toMatch(/Newest/i)
    expect(opts[1].label).toMatch(/Oldest/i)
  })

  it('date default order is newest-first (desc)', () => {
    const opts = sortOptions('date')
    expect(opts[0].value).toBe('desc')
    expect(opts[1].value).toBe('asc')
  })

  it('each option has both value and label fields', () => {
    for (const type of ['text', 'number', 'date'] as const) {
      const opts = sortOptions(type)
      for (const opt of opts) {
        expect(opt).toHaveProperty('value')
        expect(opt).toHaveProperty('label')
        expect(typeof opt.value).toBe('string')
        expect(typeof opt.label).toBe('string')
      }
    }
  })
})
