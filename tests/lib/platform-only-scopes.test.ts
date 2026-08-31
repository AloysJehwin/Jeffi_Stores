import { describe, it, expect } from 'vitest'
import { ADMIN_SCOPES, ALL_SCOPE_KEYS, TENANT_SCOPE_KEYS, assignableScopes } from '@/lib/scopes'

const ECOM = ['ecom_customers:read', 'ecom_customers:write', 'ecom_instances:read', 'ecom_billing:read', 'ecom_billing:write']

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
