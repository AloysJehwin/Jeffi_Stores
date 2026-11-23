import { describe, it, expect, afterEach } from 'vitest'
import { encryptToken, decryptToken } from '../src/cipher'

const KEY_HEX = 'a'.repeat(64)

describe('cipher', () => {
  afterEach(() => { delete process.env.SOCIAL_TOKEN_ENC_KEY })

  it('round-trips a hex key and a base64 key', () => {
    process.env.SOCIAL_TOKEN_ENC_KEY = KEY_HEX
    const enc = encryptToken('secret-token')
    expect(enc.startsWith('v1:')).toBe(true)
    expect(enc.split(':')).toHaveLength(4)
    expect(decryptToken(enc)).toBe('secret-token')

    process.env.SOCIAL_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
    expect(decryptToken(encryptToken('b64-secret'))).toBe('b64-secret')
  })

  it('a fresh IV makes every ciphertext different for the same plaintext', () => {
    process.env.SOCIAL_TOKEN_ENC_KEY = KEY_HEX
    expect(encryptToken('x')).not.toBe(encryptToken('x'))
  })

  it('throws when the key is missing or the wrong length', () => {
    expect(() => encryptToken('x')).toThrow(/SOCIAL_TOKEN_ENC_KEY is not set/)
    process.env.SOCIAL_TOKEN_ENC_KEY = 'abcd' // 2 bytes
    expect(() => encryptToken('x')).toThrow(/32 bytes/)
  })

  it('rejects a malformed ciphertext and a tampered tag', () => {
    process.env.SOCIAL_TOKEN_ENC_KEY = KEY_HEX
    expect(() => decryptToken('v2:a:b:c')).toThrow(/unrecognized ciphertext/)
    expect(() => decryptToken('v1:a:b')).toThrow(/unrecognized ciphertext/)
    const [p, iv, , ct] = encryptToken('hello').split(':')
    expect(() => decryptToken([p, iv, Buffer.alloc(16).toString('base64'), ct].join(':'))).toThrow()
  })
})
