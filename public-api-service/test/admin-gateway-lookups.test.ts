import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PLATFORM_TENANT_ID } from '@jeffi/tenancy'
import { tokenLookup, storeLookup } from '../src/admin-gateway'

const JFC = 'jfc_' + 'a'.repeat(43)
const JSA = 'jsa_' + 'b'.repeat(43)

beforeEach(() => {
  // token/store caches live on module state; unique tokens/slugs per test avoid cross-test hits.
})

describe('tokenLookup (control-plane)', () => {
  it('returns null for a malformed token without querying', async () => {
    const q = vi.fn()
    expect(await tokenLookup(q)('not-a-token')).toBeNull()
    expect(q).not.toHaveBeenCalled()
  })

  it('maps a jfc_ row to an AdminTokenRow and touches last_used_at', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'tok-1', tenant_id: 't-1', kind: 'cli', admin_id: 'adm-1', service_account_id: null, admin_role: 'admin', scopes: ['*'] }] })
      .mockResolvedValue({ rows: [] })
    const unique = 'jfc_' + 'c'.repeat(43)
    const row = await tokenLookup(q)(unique)
    expect(row).toMatchObject({ id: 'tok-1', tenantId: 't-1', kind: 'cli', adminId: 'adm-1', scopes: ['*'] })
    await Promise.resolve()
    expect(q.mock.calls.some(c => /UPDATE admin_api_tokens SET last_used_at/.test(c[0]))).toBe(true)
  })

  it('rejects a jsa_ prefix whose row is not a service_account (kind/prefix mismatch)', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 'x', tenant_id: 't', kind: 'cli', admin_id: 'a', service_account_id: null, admin_role: 'admin', scopes: [] }] })
    expect(await tokenLookup(q)('jsa_' + 'd'.repeat(43))).toBeNull()
  })

  it('caches: a second lookup of the same token does not re-query', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 'tok-2', tenant_id: 't-2', kind: 'service_account', admin_id: null, service_account_id: 'sa-1', admin_role: null, scopes: ['*'] }] })
    const look = tokenLookup(q)
    const unique = 'jsa_' + 'e'.repeat(43)
    await look(unique)
    const calls = q.mock.calls.length
    await look(unique)
    expect(q.mock.calls.length).toBe(calls) // served from cache
  })
})

describe('storeLookup (control-plane)', () => {
  it('flagship host returns the platform ref with no query', async () => {
    const q = vi.fn()
    const ref = await storeLookup(q)({ kind: 'flagship', host: 'public.jeffistores.in' })
    expect(ref).toEqual({ tenantId: PLATFORM_TENANT_ID, slug: null, name: 'Jeffi Stores', planScopes: null })
    expect(q).not.toHaveBeenCalled()
  })

  it('a non-store host (other) returns null', async () => {
    const q = vi.fn()
    expect(await storeLookup(q)({ kind: 'other', host: 'shop.example.com' })).toBeNull()
    expect(q).not.toHaveBeenCalled()
  })

  it('a live store maps to a StoreRef with its plan scopes', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 't-acme', slug: 'storelookup1', display_name: 'Acme', status: 'active', instance_state: 'running', service_types: ['store'], scopes: ['orders:read'] }] })
    const ref = await storeLookup(q)({ kind: 'store', host: 'public-storelookup1.jeffistores.in', slug: 'storelookup1' })
    expect(ref).toMatchObject({ tenantId: 't-acme', slug: 'storelookup1', name: 'Acme' })
    expect(ref!.planScopes!.has('orders:read')).toBe(true)
  })

  it('a paused / non-store tenant resolves to null', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 't-x', slug: 'storelookup2', display_name: 'X', status: 'active', instance_state: 'paused', service_types: ['store'], scopes: [] }] })
    expect(await storeLookup(q)({ kind: 'store', host: 'public-storelookup2.jeffistores.in', slug: 'storelookup2' })).toBeNull()
  })

  it('caches the resolved ref per slug', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 't-c', slug: 'storelookup3', display_name: 'C', status: 'active', instance_state: 'running', service_types: ['store'], scopes: [] }] })
    const look = storeLookup(q)
    const ph = { kind: 'store' as const, host: 'public-storelookup3.jeffistores.in', slug: 'storelookup3' }
    await look(ph)
    await look(ph)
    expect(q).toHaveBeenCalledTimes(1)
  })
})
