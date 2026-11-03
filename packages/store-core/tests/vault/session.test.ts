import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockResolve = vi.fn()
vi.mock('@/lib/auth/auth-sessions', () => ({ resolveSession: (...a: any[]) => mockResolve(...a) }))
vi.mock('@/lib/auth/session-signals-request', () => ({
  extractSessionSignals: () => ({}),
  ambientSessionSignals: async () => undefined,
}))
vi.mock('@/lib/tenancy/request-tenant', () => ({ resolveRequestTenantId: async () => 't1' }))

import { resolveVaultSid, resolveVaultSession, sessionMatchesTenant } from '@/lib/vault/session'

const row = (over: Record<string, unknown> = {}) => ({
  sid: 's',
  sessionId: 'sess-1',
  principalType: 'vault',
  principalId: 'u1',
  role: 'business',
  tenantId: 't1',
  email: 'a@b.c',
  displayName: 'A',
  ...over,
})

const req = (sid: string | undefined, tenantId: string | null) =>
  ({
    cookies: { get: (n: string) => (n === 'vault_sid' && sid ? { value: sid } : undefined) },
    headers: new Headers(tenantId ? { 'x-tenant-id': tenantId } : {}),
  }) as any

beforeEach(() => mockResolve.mockReset())

describe('vault session', () => {
  it('maps a vault principal', async () => {
    mockResolve.mockResolvedValueOnce(row())
    expect(await resolveVaultSid('s', null)).toMatchObject({ userId: 'u1', tenantId: 't1', principalType: 'business' })
  })

  it('rejects non-vault principals (a store user_sid is not a vault session)', async () => {
    mockResolve.mockResolvedValueOnce(row({ principalType: 'customer' }))
    expect(await resolveVaultSid('s', null)).toBeNull()
  })

  it('no cookie → null without a lookup', async () => {
    expect(await resolveVaultSession(req(undefined, 't1'))).toBeNull()
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('enforces the request tenant', async () => {
    mockResolve.mockResolvedValue(row())
    expect(await resolveVaultSession(req('s', 't1'))).not.toBeNull()
    expect(await resolveVaultSession(req('s', 't2'))).toBeNull()
    expect(await resolveVaultSession(req('s', null))).toBeNull()
  })

  it('sessionMatchesTenant treats platform (null) strictly', () => {
    expect(sessionMatchesTenant({ tenantId: null }, null)).toBe(true)
    expect(sessionMatchesTenant({ tenantId: null }, 't1')).toBe(false)
    expect(sessionMatchesTenant({ tenantId: 't1' }, 't1')).toBe(true)
  })
})
