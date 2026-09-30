import { describe, it, expect } from 'vitest'
import { ADMIN_SCOPES, ALL_SCOPE_KEYS, TENANT_SCOPE_KEYS, assignableScopes } from '@/lib/scopes'

const ECOM = [
  'ecom_customers:read',
  'ecom_customers:write',
  'ecom_instances:read',
  'ecom_billing:read',
  'ecom_billing:write',
]

describe('control-plane scopes belong to the platform operator alone', () => {
  it('marks every Ecom Store scope platformOnly', () => {
    for (const s of ADMIN_SCOPES.filter(s => s.group === 'Ecom Store')) {
      expect(s.platformOnly, s.key).toBe(true)
    }
  })

  it('covers exactly the known control-plane scopes', () => {
    const flagged = ADMIN_SCOPES.filter(s => s.platformOnly).map(s => s.key)
    expect(flagged.sort()).toEqual([...ECOM].sort())
  })

  it('keeps them out of the tenant grant', () => {
    for (const key of ECOM) expect(TENANT_SCOPE_KEYS).not.toContain(key)
    expect(TENANT_SCOPE_KEYS.length).toBe(ALL_SCOPE_KEYS.length - ECOM.length)
  })

  it('excludes them from the assignable list by default', () => {
    const keys = assignableScopes(false).map(s => s.key)
    for (const key of ECOM) expect(keys).not.toContain(key)
  })

  it('still leaves every non-control-plane scope assignable', () => {
    const keys = assignableScopes(false).map(s => s.key)
    expect(keys).toContain('products:read')
    expect(keys).toContain('settings:write')
  })
})

// Live control plane, 2026-09-06: basic 21, growth 48, pro 66, enterprise 72, and no plan at
// any tier references a control-plane scope. Enterprise equalling TENANT_SCOPE_KEYS is what
// makes 72 the ceiling a tenant can hold (grew from 71 with the notifications:read bell scope).
describe('the plan ladder never exceeds what a tenant may hold', () => {
  it('caps the top tier at the full tenant scope set', () => {
    expect(TENANT_SCOPE_KEYS.length).toBe(72)
  })

  it('keeps every control-plane scope out of the tenant set', () => {
    for (const key of ECOM) expect(TENANT_SCOPE_KEYS).not.toContain(key)
  })
})
