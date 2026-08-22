/**
 * Tests for src/app/api/ecom/social/state.ts — the HMAC-signed OAuth state for the Meta connect
 * flow. Pins: a signed state round-trips, a tampered state (or a bad signature) is rejected with
 * null (not a throw), and signing requires CRON_SECRET.
 *
 * CRON_SECRET is provided by vitest.config env (test-cron-secret) for the round-trip cases.
 */
import { describe, it, expect } from 'vitest'
import { signState, verifyState, type OAuthState } from '@/app/api/ecom/social/state'

const STATE: OAuthState = {
  tenantId: 't-1',
  provider: 'facebook',
  ownerId: 'owner-9',
  nonce: 'abc123',
}

describe('social/state', () => {
  it('round-trips a signed state', () => {
    const signed = signState(STATE)
    expect(signed).toContain('.')
    expect(verifyState(signed)).toEqual(STATE)
  })

  it('returns null when the signature does not match (tampered payload)', () => {
    const signed = signState(STATE)
    const [payload, sig] = signed.split('.')
    // Re-encode a different payload but keep the old signature.
    const forged = Buffer.from(JSON.stringify({ ...STATE, tenantId: 'evil' })).toString('base64url')
    expect(verifyState(`${forged}.${sig}`)).toBeNull()
    // Sanity: original still verifies.
    expect(verifyState(`${payload}.${sig}`)).toEqual(STATE)
  })

  it('returns null when the signature bytes are flipped', () => {
    const signed = signState(STATE)
    const [payload] = signed.split('.')
    expect(verifyState(`${payload}.deadbeef`)).toBeNull()
  })

  it('returns null for a malformed state (no separator)', () => {
    expect(verifyState('no-dot-here')).toBeNull()
    expect(verifyState('')).toBeNull()
  })

  it('requires CRON_SECRET to sign', () => {
    const prev = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    try {
      expect(() => signState(STATE)).toThrow(/CRON_SECRET/)
    } finally {
      process.env.CRON_SECRET = prev
    }
  })
})
