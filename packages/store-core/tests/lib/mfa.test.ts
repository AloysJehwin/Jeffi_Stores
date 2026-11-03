// ── Set env BEFORE any imports so module-level guards don't throw ─────────────
// vi.stubEnv is hoisted but runs after module evaluation; use process.env directly.
process.env.JWT_SECRET = 'test-secret-for-mfa-unit-tests-minimum-length'
process.env.MFA_ENCRYPTION_KEY = 'a'.repeat(64) // 64-char hex string → 32 bytes

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoist mock functions so vi.mock factories can reference them ──────────────
const { mockMfaSign, mockMfaJwtVerify, mockGenerateSecret, mockGenerateURI, mockOtpVerify } = vi.hoisted(() => ({
  mockMfaSign: vi.fn(),
  mockMfaJwtVerify: vi.fn(),
  mockGenerateSecret: vi.fn(),
  mockGenerateURI: vi.fn(),
  mockOtpVerify: vi.fn(),
}))

vi.mock('jose', () => {
  class SignJWT {
    private payload: Record<string, unknown>
    constructor(payload: Record<string, unknown>) {
      this.payload = payload
    }
    setProtectedHeader() {
      return this
    }
    setIssuedAt() {
      return this
    }
    setExpirationTime() {
      return this
    }
    async sign() {
      return mockMfaSign(this.payload)
    }
  }
  return { SignJWT, jwtVerify: mockMfaJwtVerify }
})

// ── Mock otplib ───────────────────────────────────────────────────────────────
vi.mock('otplib', () => ({
  generateSecret: (...args: unknown[]) => mockGenerateSecret(...args),
  generateURI: (...args: unknown[]) => mockGenerateURI(...args),
  verify: (...args: unknown[]) => mockOtpVerify(...args),
}))

// ── Import under test ─────────────────────────────────────────────────────────
import {
  issueMfaTicket,
  verifyMfaTicket,
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  buildOtpauthUrl,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '@/lib/auth/mfa'

// ─────────────────────────────────────────────────────────────────────────────

describe('issueMfaTicket', () => {
  it('returns the signed token string', async () => {
    mockMfaSign.mockResolvedValueOnce('mfa.ticket.token')
    const ticket = await issueMfaTicket({ adminId: 'a1', username: 'alice', purpose: 'enroll' })
    expect(ticket).toBe('mfa.ticket.token')
  })

  it('calls sign with correct payload including purpose', async () => {
    mockMfaSign.mockResolvedValueOnce('token')
    await issueMfaTicket({ adminId: 'a1', username: 'alice', purpose: 'verify' })
    expect(mockMfaSign).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', purpose: 'verify' }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('verifyMfaTicket', () => {
  const enrollPayload = { adminId: 'a1', username: 'alice', purpose: 'enroll', type: 'mfa_ticket' }
  const verifyPayload = { adminId: 'a1', username: 'alice', purpose: 'verify', type: 'mfa_ticket' }

  it('returns payload when purpose matches', async () => {
    mockMfaJwtVerify.mockResolvedValueOnce({ payload: enrollPayload })
    const result = await verifyMfaTicket('token', 'enroll')
    expect(result).toMatchObject({ adminId: 'a1', purpose: 'enroll' })
  })

  it('returns null when purpose does not match', async () => {
    mockMfaJwtVerify.mockResolvedValueOnce({ payload: verifyPayload })
    const result = await verifyMfaTicket('token', 'enroll')
    expect(result).toBeNull()
  })

  it('returns null when adminId is missing', async () => {
    mockMfaJwtVerify.mockResolvedValueOnce({ payload: { purpose: 'enroll', username: 'alice' } })
    const result = await verifyMfaTicket('token', 'enroll')
    expect(result).toBeNull()
  })

  it('returns null when adminId is not a string', async () => {
    mockMfaJwtVerify.mockResolvedValueOnce({ payload: { adminId: 123, purpose: 'enroll', username: 'a' } })
    const result = await verifyMfaTicket('token', 'enroll')
    expect(result).toBeNull()
  })

  it('returns null on jwt verification error (e.g. expired)', async () => {
    mockMfaJwtVerify.mockRejectedValueOnce(new Error('JWTExpired'))
    const result = await verifyMfaTicket('expired.token', 'enroll')
    expect(result).toBeNull()
  })

  it('returns payload for verify purpose', async () => {
    mockMfaJwtVerify.mockResolvedValueOnce({ payload: verifyPayload })
    const result = await verifyMfaTicket('token', 'verify')
    expect(result?.purpose).toBe('verify')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('encryptSecret / decryptSecret – round-trip', () => {
  it('encrypts and decrypts a TOTP secret correctly', () => {
    const original = 'JBSWY3DPEHPK3PXP'
    const ciphertext = encryptSecret(original)
    const plaintext = decryptSecret(ciphertext)
    expect(plaintext).toBe(original)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const secret = 'MYSECRET'
    const c1 = encryptSecret(secret)
    const c2 = encryptSecret(secret)
    expect(c1).not.toBe(c2)
  })

  it('ciphertext contains three dot-separated segments (iv.tag.enc)', () => {
    const ciphertext = encryptSecret('test')
    const parts = ciphertext.split('.')
    expect(parts).toHaveLength(3)
    expect(parts.every(p => p.length > 0)).toBe(true)
  })

  it('decryptSecret throws on malformed payload (missing segments)', () => {
    expect(() => decryptSecret('onlyone')).toThrow('malformed mfa payload')
  })

  it('decryptSecret throws on malformed payload (two segments only)', () => {
    expect(() => decryptSecret('iv.tag')).toThrow('malformed mfa payload')
  })

  it('decryptSecret throws on tampered ciphertext', () => {
    const ciphertext = encryptSecret('original')
    const parts = ciphertext.split('.')
    // Corrupt the encrypted body
    const tampered = [parts[0], parts[1], 'AAAAAAAAAA=='].join('.')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('round-trips a long secret', () => {
    const long = 'A'.repeat(128)
    expect(decryptSecret(encryptSecret(long))).toBe(long)
  })

  it('round-trips unicode characters', () => {
    const unicode = 'Héllo Wörld 🔑'
    expect(decryptSecret(encryptSecret(unicode))).toBe(unicode)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('generateTotpSecret', () => {
  it('returns the secret from otplib', async () => {
    mockGenerateSecret.mockReturnValueOnce('JBSWY3DPEHPK3PXP')
    const secret = await generateTotpSecret()
    expect(secret).toBe('JBSWY3DPEHPK3PXP')
    expect(mockGenerateSecret).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('buildOtpauthUrl', () => {
  it('returns the URI from otplib with issuer', async () => {
    const uri = 'otpauth://totp/alice?secret=ABC&issuer=Jeffi+Stores+Admin'
    mockGenerateURI.mockReturnValueOnce(uri)
    const result = await buildOtpauthUrl('alice', 'ABC')
    expect(result).toBe(uri)
    expect(mockGenerateURI).toHaveBeenCalledWith(expect.objectContaining({ secret: 'ABC', label: 'alice' }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('verifyTotp', () => {
  it('returns true for a valid 6-digit code', async () => {
    mockOtpVerify.mockReturnValueOnce({ valid: true })
    const result = await verifyTotp('SECRET', '123456')
    expect(result).toBe(true)
  })

  it('returns false for an invalid code', async () => {
    mockOtpVerify.mockReturnValueOnce({ valid: false })
    const result = await verifyTotp('SECRET', '999999')
    expect(result).toBe(false)
  })

  it('returns false for empty code', async () => {
    const result = await verifyTotp('SECRET', '')
    expect(result).toBe(false)
    expect(mockOtpVerify).not.toHaveBeenCalled()
  })

  it('returns false for a non-6-digit code', async () => {
    const result = await verifyTotp('SECRET', '12345')
    expect(result).toBe(false)
    expect(mockOtpVerify).not.toHaveBeenCalled()
  })

  it('returns false for alpha characters', async () => {
    const result = await verifyTotp('SECRET', 'abcdef')
    expect(result).toBe(false)
  })

  it('returns false for code with spaces only', async () => {
    const result = await verifyTotp('SECRET', '      ')
    expect(result).toBe(false)
  })

  it('trims whitespace before validation', async () => {
    mockOtpVerify.mockReturnValueOnce({ valid: true })
    const result = await verifyTotp('SECRET', ' 123456 ')
    expect(result).toBe(true)
  })

  it('returns false when otplib throws', async () => {
    mockOtpVerify.mockImplementationOnce(() => {
      throw new Error('otp error')
    })
    const result = await verifyTotp('SECRET', '123456')
    expect(result).toBe(false)
  })

  it('returns false when verify returns falsy valid', async () => {
    mockOtpVerify.mockReturnValueOnce({ valid: 0 })
    const result = await verifyTotp('SECRET', '123456')
    expect(result).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('generateRecoveryCodes', () => {
  it('generates 10 codes by default', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
  })

  it('generates the requested count', () => {
    const codes = generateRecoveryCodes(5)
    expect(codes).toHaveLength(5)
  })

  it('each code has plain and hash fields', () => {
    const codes = generateRecoveryCodes(3)
    for (const code of codes) {
      expect(code).toHaveProperty('plain')
      expect(code).toHaveProperty('hash')
    }
  })

  it('plain codes follow XXXXX-XXXXX uppercase hex format', () => {
    const codes = generateRecoveryCodes(10)
    const pattern = /^[0-9A-F]{5}-[0-9A-F]{5}$/
    for (const code of codes) {
      expect(code.plain).toMatch(pattern)
    }
  })

  it('hash is a 64-char hex string (SHA-256)', () => {
    const codes = generateRecoveryCodes(3)
    for (const code of codes) {
      expect(code.hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('hash matches SHA-256 of the plain code', () => {
    const codes = generateRecoveryCodes(3)
    for (const code of codes) {
      const recomputed = hashRecoveryCode(code.plain)
      expect(code.hash).toBe(recomputed)
    }
  })

  it('all plain codes are unique', () => {
    const codes = generateRecoveryCodes(10)
    const plains = codes.map(c => c.plain)
    expect(new Set(plains).size).toBe(10)
  })

  it('generates zero codes when count is 0', () => {
    expect(generateRecoveryCodes(0)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('hashRecoveryCode', () => {
  it('returns a 64-char hex SHA-256 hash', () => {
    const hash = hashRecoveryCode('ABCDE-FGHIJ')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is case-insensitive (uppercases input before hashing)', () => {
    const h1 = hashRecoveryCode('abcde-fghij')
    const h2 = hashRecoveryCode('ABCDE-FGHIJ')
    expect(h1).toBe(h2)
  })

  it('trims whitespace before hashing', () => {
    const h1 = hashRecoveryCode('  ABCDE-FGHIJ  ')
    const h2 = hashRecoveryCode('ABCDE-FGHIJ')
    expect(h1).toBe(h2)
  })

  it('produces different hashes for different codes', () => {
    const h1 = hashRecoveryCode('AAAAA-AAAAA')
    const h2 = hashRecoveryCode('BBBBB-BBBBB')
    expect(h1).not.toBe(h2)
  })

  it('is deterministic', () => {
    const code = 'HELLO-WORLD'
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code))
  })
})

// ---------------------------------------------------------------------------
// verifyMfaTicket — type !== 'mfa_ticket' branch
// ---------------------------------------------------------------------------

describe('verifyMfaTicket – type check', () => {
  it('returns null when payload type is not mfa_ticket', async () => {
    mockMfaJwtVerify.mockResolvedValueOnce({
      payload: { adminId: 'a1', username: 'alice', purpose: 'enroll', type: 'other_ticket' },
    })
    const result = await verifyMfaTicket('token', 'enroll')
    expect(result).toBeNull()
  })

  it('returns null when payload type is missing', async () => {
    mockMfaJwtVerify.mockResolvedValueOnce({
      payload: { adminId: 'a1', username: 'alice', purpose: 'enroll' },
    })
    const result = await verifyMfaTicket('token', 'enroll')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// hashRecoveryCode — fallback to JWT_SECRET when RECOVERY_CODE_PEPPER absent
// ---------------------------------------------------------------------------

describe('hashRecoveryCode – pepper fallback', () => {
  it('falls back to JWT_SECRET when RECOVERY_CODE_PEPPER is not set', () => {
    const originalPepper = process.env.RECOVERY_CODE_PEPPER
    delete process.env.RECOVERY_CODE_PEPPER

    const h1 = hashRecoveryCode('ABCDE-12345')
    expect(h1).toMatch(/^[0-9a-f]{64}$/)

    // Restore
    if (originalPepper !== undefined) {
      process.env.RECOVERY_CODE_PEPPER = originalPepper
    }
  })

  it('uses RECOVERY_CODE_PEPPER when set (different result from JWT_SECRET)', () => {
    const originalPepper = process.env.RECOVERY_CODE_PEPPER
    delete process.env.RECOVERY_CODE_PEPPER
    const withJwt = hashRecoveryCode('ABCDE-12345')

    process.env.RECOVERY_CODE_PEPPER = 'a-different-pepper-value-for-testing'
    const withPepper = hashRecoveryCode('ABCDE-12345')

    expect(withJwt).not.toBe(withPepper)

    // Restore
    if (originalPepper !== undefined) {
      process.env.RECOVERY_CODE_PEPPER = originalPepper
    } else {
      delete process.env.RECOVERY_CODE_PEPPER
    }
  })
})

// ---------------------------------------------------------------------------
// encryptSecret / getKey — non-hex key path (sha256 derivation)
// ---------------------------------------------------------------------------

describe('encryptSecret / decryptSecret – short key (sha256 path)', () => {
  it('encrypts and decrypts correctly with a short non-hex key', () => {
    const originalKey = process.env.MFA_ENCRYPTION_KEY
    // A key that is NOT 64 chars → triggers sha256 derivation in getKey()
    process.env.MFA_ENCRYPTION_KEY = 'short-key-triggers-sha256-path'

    const ciphertext = encryptSecret('test-secret')
    const plaintext = decryptSecret(ciphertext)
    expect(plaintext).toBe('test-secret')

    process.env.MFA_ENCRYPTION_KEY = originalKey
  })
})
