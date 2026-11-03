import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
}))

import { mintVaultTicket, consumeVaultTicket, isSafeTargetPath, safeTargetPath, hashTicket } from '@/lib/vault/sso'

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

beforeEach(() => {
  mockQuery.mockReset()
  mockQueryOne.mockReset()
})

describe('isSafeTargetPath', () => {
  it.each(['/library', '/item/abc?x=1', '/item/a%2Fb'])('accepts %s', p => expect(isSafeTargetPath(p)).toBe(true))
  it.each([
    '',
    'library',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '/a\\b',
    '/a\nb',
    '/' + 'x'.repeat(600),
  ])('rejects %j', p => expect(isSafeTargetPath(p)).toBe(false))
  it('falls back to /library', () => {
    expect(safeTargetPath('//evil.com')).toBe('/library')
    expect(safeTargetPath(null)).toBe('/library')
  })
})

const STATE = 'b'.repeat(64)

describe('mintVaultTicket', () => {
  it('stores only hashes (token + state) and a sanitized target', async () => {
    const { token } = await mintVaultTicket({
      userId: 'u1',
      principalType: 'business',
      targetPath: '//evil.com',
      state: STATE,
    })
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO vault_tickets')
    expect(params[0]).toBe(sha(token))
    expect(params).not.toContain(token)
    expect(params).not.toContain(STATE)
    expect(params.slice(1, 5)).toEqual(['u1', 'business', '/library', sha(STATE)])
  })

  it('refuses to mint without a valid state', async () => {
    await expect(
      mintVaultTicket({ userId: 'u1', principalType: 'customer', targetPath: '/library', state: 'short' })
    ).rejects.toThrow()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('issues distinct tokens', async () => {
    const a = await mintVaultTicket({ userId: 'u1', principalType: 'customer', targetPath: '/library', state: STATE })
    const b = await mintVaultTicket({ userId: 'u1', principalType: 'customer', targetPath: '/library', state: STATE })
    expect(a.token).not.toBe(b.token)
  })
})

describe('consumeVaultTicket', () => {
  const token = 'a'.repeat(64)

  it('burns by hash only when unused, unexpired and the browser state matches', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'u1', principal_type: 'customer', target_path: '/item/p1' })
    const r = await consumeVaultTicket(token, STATE)
    expect(r).toEqual({ userId: 'u1', principalType: 'customer', targetPath: '/item/p1' })
    const [sql, params] = mockQueryOne.mock.calls[0]
    expect(sql).toMatch(/SET used_at = now\(\)/)
    expect(sql).toMatch(/state_hash = \$2/)
    expect(sql).toMatch(/used_at IS NULL AND expires_at > now\(\)/)
    expect(params).toEqual([hashTicket(token), hashTicket(STATE)])
  })

  it('returns null on replay / expiry / state mismatch (no row updated)', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    expect(await consumeVaultTicket(token, STATE)).toBeNull()
  })

  it('rejects a missing or malformed state without touching the DB (login CSRF)', async () => {
    expect(await consumeVaultTicket(token, undefined)).toBeNull()
    expect(await consumeVaultTicket(token, 'nope')).toBeNull()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('rejects malformed tokens without touching the DB', async () => {
    expect(await consumeVaultTicket('nope', STATE)).toBeNull()
    expect(await consumeVaultTicket('', STATE)).toBeNull()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('re-validates a stored target and rejects unexpected principals', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'u1', principal_type: 'business', target_path: 'https://evil.com' })
    expect((await consumeVaultTicket(token, STATE))?.targetPath).toBe('/library')
    mockQueryOne.mockResolvedValueOnce({ user_id: 'u1', principal_type: 'admin', target_path: '/library' })
    expect(await consumeVaultTicket(token, STATE)).toBeNull()
  })
})
