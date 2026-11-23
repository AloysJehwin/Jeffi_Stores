import { describe, it, expect, vi, beforeEach } from 'vitest'

// mainPool is the only external dependency; capture the pool it returns.
const query = vi.fn()
vi.mock('@jeffi/tenancy', () => ({
  mainPool: vi.fn(() => ({ query })),
}))

import { cp, hashKey, generateKey, lookupKey, touchKey, type ApiKeyRow } from '../src/keys'

process.env.CONTROL_PLANE_DATABASE_URL = 'postgres://x'

const row = (over: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: 'k1', owner_id: 'o1', tenant_id: 't1', tenant_slug: 'acme',
  service_types: ['messaging'], pending_services: [], name: 'k', key_prefix: 'jk_live_a',
  scopes: ['messages:send'], rate_limit_per_min: 120, status: 'active', ...over,
})

beforeEach(() => {
  query.mockReset()
})

describe('keys — hashing + generation', () => {
  it('hashKey is deterministic sha256 hex', () => {
    const h = hashKey('jk_live_abc')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashKey('jk_live_abc')).toBe(h)
    expect(hashKey('other')).not.toBe(h)
  })

  it('generateKey returns a jk_live_ key, its 16-char prefix and matching hash', () => {
    const { plain, prefix, hash } = generateKey()
    expect(plain.startsWith('jk_live_')).toBe(true)
    expect(prefix).toBe(plain.slice(0, 16))
    expect(hash).toBe(hashKey(plain))
  })
})

describe('keys — cp() pool', () => {
  it('throws when CONTROL_PLANE_DATABASE_URL is unset', async () => {
    const saved = process.env.CONTROL_PLANE_DATABASE_URL
    delete process.env.CONTROL_PLANE_DATABASE_URL
    vi.resetModules()
    const mod = await import('../src/keys')
    expect(() => mod.cp()).toThrow(/CONTROL_PLANE_DATABASE_URL/)
    process.env.CONTROL_PLANE_DATABASE_URL = saved
  })

  it('cp() memoizes the pool', () => {
    expect(cp()).toBe(cp())
  })
})

describe('keys — lookupKey', () => {
  it('returns an active row and caches it (one DB hit for two lookups)', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const plain = 'jk_live_cacheme'
    const a = await lookupKey(plain)
    const b = await lookupKey(plain)
    expect(a).toEqual(row())
    expect(b).toEqual(row())
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('returns null for a revoked row', async () => {
    query.mockResolvedValue({ rows: [row({ status: 'revoked' })] })
    expect(await lookupKey('jk_live_revoked')).toBeNull()
  })

  it('returns null when no row matches', async () => {
    query.mockResolvedValue({ rows: [] })
    expect(await lookupKey('jk_live_missing')).toBeNull()
  })
})

describe('keys — touchKey', () => {
  it('runs the usage upsert (messages increments the messages column)', async () => {
    query.mockResolvedValue({ rows: [] })
    touchKey('k1', 'messages', 150)
    await Promise.resolve()
    const [, params] = query.mock.calls[0]
    expect(params).toEqual(['k1', 1, 0, 150])
  })

  it('documents increments the documents column; a null kind neither', async () => {
    query.mockResolvedValue({ rows: [] })
    touchKey('k1', 'documents')
    touchKey('k1', null)
    await Promise.resolve()
    expect(query.mock.calls[0][1]).toEqual(['k1', 0, 1, 0])
    expect(query.mock.calls[1][1]).toEqual(['k1', 0, 0, 0])
  })

  it('swallows a DB error', async () => {
    query.mockRejectedValue(new Error('db down'))
    expect(() => touchKey('k1', null)).not.toThrow()
    await Promise.resolve()
  })
})
