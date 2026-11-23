import { describe, it, expect } from 'vitest'
import {
  runWithTenant,
  runAsPlatform,
  isPlatformScope,
  currentScope,
  currentTenant,
  requireTenant,
  currentAdminId,
} from '../src/context'
import type { TenantContext } from '../src/context'

const TENANT: TenantContext = {
  tenantId: 't-1',
  slug: 'acme',
  displayName: 'Acme',
  plan: 'pro',
  infra: null,
}

describe('context — outside any scope', () => {
  it('returns null/false defaults with no store', () => {
    expect(currentScope()).toBeNull()
    expect(currentTenant()).toBeNull()
    expect(currentAdminId()).toBeNull()
    expect(isPlatformScope()).toBe(false)
  })

  it('requireTenant throws when no tenant in scope', () => {
    expect(() => requireTenant()).toThrow('No tenant in scope')
  })
})

describe('runWithTenant', () => {
  it('exposes the tenant and adminId within the callback', async () => {
    const seen = await runWithTenant(
      TENANT,
      async () => ({
        tenant: currentTenant(),
        scope: currentScope(),
        admin: currentAdminId(),
        platform: isPlatformScope(),
        required: requireTenant(),
      }),
      'admin-7',
    )
    expect(seen.tenant).toBe(TENANT)
    expect(seen.scope).toEqual({ tenant: TENANT, adminId: 'admin-7' })
    expect(seen.admin).toBe('admin-7')
    expect(seen.platform).toBe(false)
    expect(seen.required).toBe(TENANT)
  })

  it('defaults adminId to null when omitted', async () => {
    const admin = await runWithTenant(TENANT, async () => currentAdminId())
    expect(admin).toBeNull()
  })
})

describe('runAsPlatform', () => {
  it('marks platform scope with a null tenant', async () => {
    const seen = await runAsPlatform(
      async () => ({
        platform: isPlatformScope(),
        tenant: currentTenant(),
        admin: currentAdminId(),
      }),
      'root',
    )
    expect(seen.platform).toBe(true)
    expect(seen.tenant).toBeNull()
    expect(seen.admin).toBe('root')
  })

  it('requireTenant still throws inside platform scope', async () => {
    await runAsPlatform(async () => {
      expect(() => requireTenant()).toThrow('No tenant in scope')
    })
  })

  it('defaults adminId to null', async () => {
    const admin = await runAsPlatform(async () => currentAdminId())
    expect(admin).toBeNull()
  })
})
