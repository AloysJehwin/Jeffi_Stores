import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

const { mockQuery, mockClientQuery } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockClientQuery: vi.fn() }))

vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query: mockQuery, connect: async () => ({ query: mockClientQuery, release: () => {} }) }),
}))

import {
  approveDeviceAuth,
  grantableScopes,
  isApiToken,
  newToken,
  normaliseUserCode,
  pollDeviceAuth,
  publicApiOrigin,
  resolveApiToken,
  revokeApiToken,
  startDeviceAuth,
  tokenTtlSeconds,
} from '@/lib/auth/api-tokens'

const FLAGSHIP = '00000000-0000-0000-0000-000000000000'
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

// The transaction's SELECT … FOR UPDATE returns `row`; BEGIN/UPDATE/COMMIT return nothing.
function txRow(row: Record<string, unknown> | null) {
  mockClientQuery.mockImplementation(async (sql: string) => (sql.includes('FOR UPDATE') ? { rows: row ? [row] : [] } : { rows: [] }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('tokens', () => {
  it('jfc_ for people, jsa_ for service accounts; only the hash is kept', () => {
    const p = newToken('cli')
    const s = newToken('service_account')
    expect(p.plain).toMatch(/^jfc_[A-Za-z0-9_-]{43}$/)
    expect(s.plain).toMatch(/^jsa_/)
    expect(p.hash).toBe(sha(p.plain))
    expect(p.prefix).toBe(p.plain.slice(0, 12))
    expect(isApiToken(p.plain) && isApiToken(s.plain)).toBe(true)
    expect(isApiToken('eyJhbGciOi')).toBe(false)
  })

  it('normalises a typed user code', () => {
    expect(normaliseUserCode('bcdf ghjk')).toBe('BCDF-GHJK')
    expect(normaliseUserCode('BCDF-GHJA')).toBeNull()
    expect(normaliseUserCode('BCD')).toBeNull()
  })

  it('caps an administrator at a day and rejects unknown lifetimes', () => {
    expect(tokenTtlSeconds('7d', 'admin')).toBe(604800)
    expect(tokenTtlSeconds('7d', 'administrator')).toBe(86400)
    expect(tokenTtlSeconds(undefined, 'admin')).toBe(43200)
    expect(tokenTtlSeconds('30d', 'admin')).toBeNull()
    expect(tokenTtlSeconds(10, 'admin')).toBeNull()
  })

  it('grants only scopes the holder has', () => {
    const holder = { role: 'admin', scopes: ['orders:write', 'products:read'], tenantId: 't1' }
    expect(grantableScopes('all', holder)).toEqual(['*'])
    expect(grantableScopes('read', holder)).toEqual(expect.arrayContaining(['orders:read', 'products:read']))
    expect(grantableScopes('read', holder)).not.toContain('settings:read')
    expect(grantableScopes(['orders:write'], holder)).toEqual(['orders:write'])
    expect(grantableScopes('orders:read, products:read', holder)).toEqual(['orders:read', 'products:read'])
    expect(grantableScopes(['settings:write'], holder)).toBeNull()
    expect(grantableScopes(['nope:read'], { ...holder, role: 'administrator' })).toBeNull()
  })

  it("names the store's public origin", () => {
    expect(publicApiOrigin('admin-acme.jeffistores.in', 'acme')).toBe('https://public-acme.jeffistores.in')
    expect(publicApiOrigin('admin.jeffistores.in', null)).toBe('https://public.jeffistores.in')
    expect(publicApiOrigin('admin-acme.localhost:3000', 'acme')).toBe('http://public-acme.localhost:3000')
  })
})

describe('device login', () => {
  it('starts a pending login for the store, storing only the device code hash', async () => {
    const r = await startDeviceAuth(null, { host: 'admin.jeffistores.in', clientName: 'jeffi CLI' })
    expect(r.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    const insert = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT'))!
    expect(insert[1][0]).toBe(FLAGSHIP)
    expect(insert[1][1]).toBe(sha(r.deviceCode))
    expect(JSON.stringify(insert[1])).not.toContain(r.deviceCode)
  })

  it('pending, then slow_down when polled too fast', async () => {
    txRow({ id: 'r1', tenant_id: FLAGSHIP, status: 'pending', token_hash: null, scopes: [], expires_at: null, pending_expired: false, polled_recently: false, stale: false })
    expect(await pollDeviceAuth('dc', null)).toEqual({ error: 'authorization_pending' })
    txRow({ id: 'r1', tenant_id: FLAGSHIP, status: 'pending', token_hash: null, scopes: [], expires_at: null, pending_expired: false, polled_recently: true, stale: false })
    expect(await pollDeviceAuth('dc', null)).toEqual({ error: 'slow_down' })
  })

  it("a device code of another store reads as expired", async () => {
    txRow({ id: 'r1', tenant_id: 'other', status: 'active', token_hash: null, scopes: ['*'], expires_at: null, pending_expired: false, polled_recently: false, stale: false })
    expect(await pollDeviceAuth('dc', null)).toEqual({ error: 'expired_token' })
  })

  it('mints the token once, on the first poll after approval', async () => {
    txRow({ id: 'r1', tenant_id: FLAGSHIP, status: 'active', token_hash: null, scopes: ['*'], expires_at: '2030-01-01T00:00:00Z', pending_expired: false, polled_recently: false, stale: false })
    const r = await pollDeviceAuth('dc', null)
    expect(r).toMatchObject({ scopes: ['*'], expiresAt: '2030-01-01T00:00:00.000Z' })
    const token = (r as { token: string }).token
    expect(token).toMatch(/^jfc_/)
    const update = mockClientQuery.mock.calls.find(c => String(c[0]).startsWith('UPDATE'))!
    expect(update[1]).toEqual(['r1', sha(token), token.slice(0, 12)])
    txRow({ id: 'r1', tenant_id: FLAGSHIP, status: 'active', token_hash: sha(token), scopes: ['*'], expires_at: null, pending_expired: false, polled_recently: false, stale: false })
    expect(await pollDeviceAuth('dc', null)).toEqual({ error: 'expired_token' })
  })

  it('drops an approval the CLI never collected', async () => {
    txRow({ id: 'r1', tenant_id: FLAGSHIP, status: 'active', token_hash: null, scopes: ['*'], expires_at: null, pending_expired: false, polled_recently: false, stale: true })
    expect(await pollDeviceAuth('dc', null)).toEqual({ error: 'expired_token' })
    expect(mockClientQuery.mock.calls.some(c => String(c[0]).startsWith('DELETE'))).toBe(true)
  })

  it('a denied login reports access_denied', async () => {
    txRow({ id: 'r1', tenant_id: FLAGSHIP, status: 'denied', token_hash: null, scopes: [], expires_at: null, pending_expired: false, polled_recently: false, stale: false })
    expect(await pollDeviceAuth('dc', null)).toEqual({ error: 'access_denied' })
  })

  it('approves only a live code of this store', async () => {
    expect(await approveDeviceAuth({ userCode: 'nonsense', tenantId: null, adminId: 'a', adminRole: 'admin', decision: 'approve', scopes: ['*'], ttlSeconds: 3600 })).toBe('not_found')
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
    expect(await approveDeviceAuth({ userCode: 'bcdfghjk', tenantId: 't1', adminId: 'a', adminRole: 'admin', decision: 'approve', scopes: ['orders:read'], ttlSeconds: 3600 })).toBe('approved')
    expect(mockQuery.mock.calls.at(-1)![1].slice(0, 2)).toEqual(['BCDF-GHJK', 't1'])
  })
})

describe('resolution and revocation', () => {
  const row = { id: 'tok', tenant_id: FLAGSHIP, kind: 'cli', admin_id: 'a', service_account_id: null, admin_role: 'admin', scopes: ['*'], host: 'admin.jeffistores.in', expires_at: null }

  it('looks a token up by its hash', async () => {
    const t = newToken('cli')
    mockQuery.mockResolvedValueOnce({ rows: [row] })
    expect(await resolveApiToken(t.plain, { touch: false })).toMatchObject({ id: 'tok', tenantId: FLAGSHIP, kind: 'cli' })
    expect(mockQuery.mock.calls[0][1]).toEqual([t.hash])
  })

  it('a prefix that does not match the holder type is refused', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row] })
    expect(await resolveApiToken(newToken('service_account').plain, { touch: false })).toBeNull()
    expect(await resolveApiToken('not-a-token')).toBeNull()
  })

  it("revokes only the admin's own token when scoped to them", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tok' }] })
    expect(await revokeApiToken({ id: 'tok', tenantId: null, adminId: 'a' })).toBe(true)
    expect(mockQuery.mock.calls[0][0]).toContain('admin_id = $3')
    expect(mockQuery.mock.calls[0][1]).toEqual(['tok', FLAGSHIP, 'a'])
  })
})
