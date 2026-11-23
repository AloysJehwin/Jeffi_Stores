import { describe, it, expect } from 'vitest'
import {
  resolveReturnPolicy,
  DEFAULT_RETURN_POLICY,
  type PolicyFields,
} from '@/lib/catalog/return-policy-rules'

describe('resolveReturnPolicy', () => {
  it('falls back to defaults when nothing is set', () => {
    const r = resolveReturnPolicy({})
    expect(r).toMatchObject({ ...DEFAULT_RETURN_POLICY, source: 'default' })
  })

  it('brand-only source and values', () => {
    const brand: PolicyFields = {
      return_allowed: false,
      return_window_days: 3,
      replacement_allowed: true,
      replacement_window_days: 5,
    }
    const r = resolveReturnPolicy({ brand })
    expect(r.source).toBe('brand')
    expect(r.return_allowed).toBe(false)
    expect(r.return_window_days).toBe(3)
    expect(r.replacement_window_days).toBe(5)
  })

  it('category-only (own category set) source', () => {
    const r = resolveReturnPolicy({ category: { return_allowed: true, return_window_days: 10 } })
    expect(r.source).toBe('category')
    expect(r.return_window_days).toBe(10)
  })

  it('parent_category when only the parent carries flags', () => {
    const r = resolveReturnPolicy({
      category: { return_window_days: 9 }, // no allowed flags → ownCatSet false
      parent: { return_allowed: true, return_window_days: 12 },
    })
    expect(r.source).toBe('parent_category')
    // child window overrides parent window
    expect(r.return_window_days).toBe(9)
  })

  it('restrictive: brand AND category set → stricter wins', () => {
    const r = resolveReturnPolicy({
      brand: { return_allowed: true, return_window_days: 10 },
      category: { return_allowed: false, return_window_days: 5 },
    })
    expect(r.source).toBe('restrictive')
    expect(r.return_allowed).toBe(false) // every() with a false
    expect(r.return_window_days).toBe(5) // min
  })

  it('product window overrides everything; >0 allows', () => {
    const r = resolveReturnPolicy({
      productReturnWindowDays: 14,
      brand: { return_allowed: false, return_window_days: 3 },
    })
    expect(r.source).toBe('product')
    expect(r.return_window_days).toBe(14)
    expect(r.return_allowed).toBe(true)
  })

  it('product window 0 disallows returns', () => {
    const r = resolveReturnPolicy({ productReturnWindowDays: 0 })
    expect(r.source).toBe('product')
    expect(r.return_window_days).toBe(0)
    expect(r.return_allowed).toBe(false)
  })

  it('negative product window clamps to 0', () => {
    const r = resolveReturnPolicy({ productReturnWindowDays: -5 })
    expect(r.return_window_days).toBe(0)
    expect(r.return_allowed).toBe(false)
  })

  it('non-finite product window is ignored', () => {
    const r = resolveReturnPolicy({ productReturnWindowDays: Number.NaN, brand: { return_window_days: 4 } })
    expect(r.source).not.toBe('product')
    expect(r.return_window_days).toBe(4)
  })

  it('category inherits each blank field from the parent', () => {
    const r = resolveReturnPolicy({
      category: { return_allowed: true }, // window blank → from parent
      parent: { return_window_days: 20, replacement_window_days: 25, replacement_allowed: true },
    })
    expect(r.return_window_days).toBe(20)
    expect(r.replacement_window_days).toBe(25)
  })
})
