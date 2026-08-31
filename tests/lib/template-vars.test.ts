import { describe, it, expect } from 'vitest'
import { buildVarMap, substituteVars, previewVarMap, TEMPLATE_VARS } from '@/lib/template-vars'

describe('buildVarMap', () => {
  it('maps customer fields correctly', () => {
    const map = buildVarMap({
      recipient: { email: 'a@b.com', first_name: 'Alice', last_name: 'Smith' },
    })
    expect(map.customer_first_name).toBe('Alice')
    expect(map.customer_last_name).toBe('Smith')
    expect(map.customer_name).toBe('Alice Smith')
    expect(map.customer_email).toBe('a@b.com')
  })

  it('falls back to "there" when first_name is missing', () => {
    const map = buildVarMap({ recipient: { email: 'x@y.com' } })
    expect(map.customer_first_name).toBe('there')
    expect(map.customer_name).toBe('there')
  })

  it('uses only last name in full name when first_name is empty', () => {
    const map = buildVarMap({ recipient: { email: 'x@y.com', first_name: '', last_name: 'Jones' } })
    expect(map.customer_last_name).toBe('Jones')
    // full name = 'Jones' when first_name is blank
    expect(map.customer_name).toBe('Jones')
  })

  it('leaves store fields blank when no store context is given', () => {
    // Never the platform's identity: a tenant caller that omits `store` would otherwise
    // sign its mail with the platform's name and contact details.
    const map = buildVarMap({ recipient: { email: 'x@y.com' } })
    expect(map.store_name).toBe('')
    expect(map.store_email).toBe('')
  })

  it('overrides store fields when store context provided', () => {
    const map = buildVarMap({
      recipient: { email: 'x@y.com' },
      store: { name: 'My Shop', email: 'shop@test.com' },
    })
    expect(map.store_name).toBe('My Shop')
    expect(map.store_email).toBe('shop@test.com')
    expect(map.store_phone).toBe('')
  })

  it('includes current_year as a 4-digit string', () => {
    const map = buildVarMap({ recipient: { email: 'x@y.com' } })
    expect(map.current_year).toMatch(/^\d{4}$/)
  })

  it('includes a date field', () => {
    const map = buildVarMap({ recipient: { email: 'x@y.com' } })
    expect(map.date).toBeTruthy()
    expect(typeof map.date).toBe('string')
  })

  it('trims whitespace from first_name and last_name', () => {
    const map = buildVarMap({ recipient: { email: 'x@y.com', first_name: '  Bob  ', last_name: '  Lee  ' } })
    expect(map.customer_first_name).toBe('Bob')
    expect(map.customer_last_name).toBe('Lee')
  })
})

describe('substituteVars', () => {
  const vars = { name: 'Alice', year: '2025', store: 'Jeffi' }

  it('replaces known placeholders', () => {
    expect(substituteVars('Hello {name}!', vars)).toBe('Hello Alice!')
  })

  it('replaces multiple placeholders', () => {
    expect(substituteVars('{store} — {year}', vars)).toBe('Jeffi — 2025')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(substituteVars('Hi {unknown}', vars)).toBe('Hi {unknown}')
  })

  it('returns empty string unchanged', () => {
    expect(substituteVars('', vars)).toBe('')
  })

  it('is case-insensitive for placeholder names', () => {
    expect(substituteVars('{NAME}', vars)).toBe('Alice')
  })

  it('handles template with no placeholders', () => {
    expect(substituteVars('Plain text', vars)).toBe('Plain text')
  })
})

describe('previewVarMap', () => {
  it('returns an object with all TEMPLATE_VARS keys', () => {
    const preview = previewVarMap()
    for (const tv of TEMPLATE_VARS) {
      expect(preview).toHaveProperty(tv.key)
      expect(preview[tv.key]).toBe(tv.sample)
    }
  })
})

describe('TEMPLATE_VARS', () => {
  it('has at least 10 entries', () => {
    expect(TEMPLATE_VARS.length).toBeGreaterThanOrEqual(10)
  })

  it('each entry has key, label, description, group, sample', () => {
    for (const tv of TEMPLATE_VARS) {
      expect(tv.key).toBeTruthy()
      expect(tv.label).toBeTruthy()
      expect(tv.description).toBeTruthy()
      expect(['customer', 'store', 'date']).toContain(tv.group)
      expect(tv.sample).toBeDefined()
    }
  })
})
