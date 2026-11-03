import { describe, it, expect, beforeAll } from 'vitest'
import { signAdminState, verifyAdminState, safeReturnBase } from '@/lib/shared/oauth-state'

beforeAll(() => {
  process.env.CRON_SECRET = 'test-cron-secret-at-least-32-bytes!!!!'
})

describe('signAdminState / verifyAdminState', () => {
  it('round-trips the tenant returnBase through the signed state', () => {
    const state = signAdminState({
      tenantId: 't_123',
      provider: 'google_sheets',
      nonce: 'abcd',
      returnBase: 'https://admin-acme.jeffistores.in',
    })
    const parsed = verifyAdminState(state)
    expect(parsed?.tenantId).toBe('t_123')
    expect(parsed?.returnBase).toBe('https://admin-acme.jeffistores.in')
  })

  it('rejects a tampered payload', () => {
    const state = signAdminState({ tenantId: 't_123', provider: 'google_sheets', nonce: 'abcd' })
    const [payload, sig] = state.split('.')
    const forged = Buffer.from(
      JSON.stringify({ tenantId: 'other', provider: 'google_sheets', nonce: 'abcd' })
    ).toString('base64url')
    expect(verifyAdminState(`${forged}.${sig}`)).toBeNull()
    expect(verifyAdminState(`${payload}.deadbeef`)).toBeNull()
  })
})

describe('state expiry', () => {
  it('rejects a state older than 30 minutes and accepts a fresh one', () => {
    const now = Date.now()
    const fresh = signAdminState({ tenantId: 't', provider: 'amazon_seller', nonce: 'n' })
    expect(verifyAdminState(fresh)?.iat).toBeTypeOf('number')
    const old = signAdminState({
      tenantId: 't',
      provider: 'amazon_seller',
      nonce: 'n',
      iat: Math.floor(now / 1000) - 31 * 60,
    })
    expect(verifyAdminState(old)).toBeNull()
  })
})

describe('safeReturnBase', () => {
  const tenantAdmin = 'https://admin-acme.jeffistores.in'

  it('returns the origin when returnBase matches the tenant admin host', () => {
    expect(safeReturnBase('https://admin-acme.jeffistores.in', tenantAdmin)).toBe('https://admin-acme.jeffistores.in')
  })

  it('rejects a different tenant admin host (no cross-tenant redirect)', () => {
    expect(safeReturnBase('https://admin-evil.jeffistores.in', tenantAdmin)).toBeNull()
  })

  it('rejects the platform admin host when the tenant is a tenant', () => {
    expect(safeReturnBase('https://admin.jeffistores.in', tenantAdmin)).toBeNull()
  })

  it('rejects non-https schemes', () => {
    expect(safeReturnBase('http://admin-acme.jeffistores.in', tenantAdmin)).toBeNull()
  })

  it('rejects a malformed or missing returnBase', () => {
    expect(safeReturnBase(undefined, tenantAdmin)).toBeNull()
    expect(safeReturnBase('not a url', tenantAdmin)).toBeNull()
  })
})

describe('safeReturnBase on a local dev host', () => {
  it('accepts http only for localhost tenant admins', () => {
    expect(safeReturnBase('http://admin-acme.localhost:3000', 'http://admin-acme.localhost:3000')).toBe('http://admin-acme.localhost:3000')
    expect(safeReturnBase('http://admin-acme.jeffistores.in', 'http://admin-acme.jeffistores.in')).toBeNull()
  })
})
