import crypto from 'crypto'

// AES-256-GCM cipher for secrets at rest (tenant Meta long-lived tokens). The key comes
// from SOCIAL_TOKEN_ENC_KEY — a 32-byte key, hex or base64, sourced from Secrets Manager
// (jeffi/production). Format of an encrypted value: v1:<iv_b64>:<tag_b64>:<ct_b64>, so the
// scheme is self-describing and rotatable later without guessing the layout.

const ALGO = 'aes-256-gcm'
const PREFIX = 'v1'

function loadKey(): Buffer {
  const raw = process.env.SOCIAL_TOKEN_ENC_KEY
  if (!raw || !raw.trim()) {
    throw new Error('SOCIAL_TOKEN_ENC_KEY is not set — required to encrypt/decrypt social tokens at rest')
  }
  // Accept hex (64 chars) or base64; must decode to exactly 32 bytes.
  const key = /^[0-9a-fA-F]{64}$/.test(raw.trim()) ? Buffer.from(raw.trim(), 'hex') : Buffer.from(raw.trim(), 'base64')
  if (key.length !== 32) {
    throw new Error(
      `SOCIAL_TOKEN_ENC_KEY must decode to 32 bytes (got ${key.length}) — use a hex(64) or base64 256-bit key`
    )
  }
  return key
}

/** Encrypt a plaintext secret → self-describing string safe to store in a text column. */
export function encryptToken(plaintext: string): string {
  const key = loadKey()
  const iv = crypto.randomBytes(12) // 96-bit nonce, GCM standard
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

/** Decrypt a value produced by encryptToken. Throws on tamper (GCM auth fail) or bad format. */
export function decryptToken(encoded: string): string {
  const parts = encoded.split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('decryptToken: unrecognized ciphertext format')
  }
  const key = loadKey()
  const [, ivB64, tagB64, ctB64] = parts
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
  return pt.toString('utf8')
}
