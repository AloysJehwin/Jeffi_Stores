/**
 * Tests for src/lib/crypto/token-cipher.ts — AES-256-GCM at-rest cipher for tenant Meta
 * tokens. Pins the security-critical behaviours: an encrypted value round-trips, tampering
 * is detected (GCM auth), a malformed value is rejected, and the key is mandatory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// A real 256-bit key as 64 hex chars.
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

describe('token-cipher', () => {
  beforeEach(() => {
    process.env.SOCIAL_TOKEN_ENC_KEY = KEY
  })

  afterEach(() => {
    delete process.env.SOCIAL_TOKEN_ENC_KEY
  })

  it('round-trips a plaintext token', async () => {
    const { encryptToken, decryptToken } = await import('@/lib/crypto/token-cipher')
    const secret = 'EAAG-long-lived-page-token-xyz'
    const enc = encryptToken(secret)
    expect(enc).not.toContain(secret)
    expect(enc.startsWith('v1:')).toBe(true)
    expect(enc.split(':')).toHaveLength(4)
    expect(decryptToken(enc)).toBe(secret)
  })

  it('produces a fresh IV per call (same plaintext → different ciphertext)', async () => {
    const { encryptToken } = await import('@/lib/crypto/token-cipher')
    expect(encryptToken('same')).not.toBe(encryptToken('same'))
  })

  it('throws when the ciphertext has been tampered with (GCM auth fail)', async () => {
    const { encryptToken, decryptToken } = await import('@/lib/crypto/token-cipher')
    const enc = encryptToken('tamper-me')
    const [prefix, iv, tag, ct] = enc.split(':')
    // Flip a byte in the ciphertext segment.
    const buf = Buffer.from(ct, 'base64')
    buf[0] = buf[0] ^ 0xff
    const tampered = [prefix, iv, tag, buf.toString('base64')].join(':')
    expect(() => decryptToken(tampered)).toThrow()
  })

  it('throws on an unrecognized ciphertext format', async () => {
    const { decryptToken } = await import('@/lib/crypto/token-cipher')
    expect(() => decryptToken('not-a-valid-token')).toThrow(/unrecognized ciphertext format/)
    expect(() => decryptToken('v2:a:b:c')).toThrow(/unrecognized ciphertext format/)
  })

  it('requires SOCIAL_TOKEN_ENC_KEY to be set', async () => {
    delete process.env.SOCIAL_TOKEN_ENC_KEY
    const { encryptToken } = await import('@/lib/crypto/token-cipher')
    expect(() => encryptToken('x')).toThrow(/SOCIAL_TOKEN_ENC_KEY/)
  })

  it('rejects a key that does not decode to 32 bytes', async () => {
    process.env.SOCIAL_TOKEN_ENC_KEY = 'deadbeef'
    const { encryptToken } = await import('@/lib/crypto/token-cipher')
    expect(() => encryptToken('x')).toThrow(/32 bytes/)
  })
})
