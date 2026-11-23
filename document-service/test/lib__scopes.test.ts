import { describe, it, expect } from 'vitest'
import { hasScope } from '../src/lib/scopes.js'

describe('hasScope', () => {
  it('administrator always passes', () => {
    expect(hasScope('administrator', undefined, 'anything:read')).toBe(true)
  })
  it('exact scope match', () => {
    expect(hasScope('staff', ['orders:read'], 'orders:read')).toBe(true)
  })
  it(':read is satisfied by the matching :write', () => {
    expect(hasScope('staff', ['orders:write'], 'orders:read')).toBe(true)
  })
  it('legacy child resolves via its parent :read', () => {
    expect(hasScope('staff', ['orders:read'], 'delhivery:read')).toBe(true)
  })
  it('legacy child :read resolves via the parent :write', () => {
    expect(hasScope('staff', ['orders:write'], 'delhivery:read')).toBe(true)
  })
  it('false when nothing matches', () => {
    expect(hasScope('staff', ['inventory:read'], 'orders:read')).toBe(false)
    expect(hasScope('staff', [], 'delhivery:read')).toBe(false)
  })
  it('handles undefined role and scopes', () => {
    expect(hasScope(undefined, undefined, 'orders:read')).toBe(false)
  })
})
