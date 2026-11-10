import crypto from 'node:crypto'

// Same AES-256-GCM scheme as the app's lib/crypto/token-cipher.ts (v1:<iv>:<tag>:<ct>, base64 parts), keyed
// by SOCIAL_TOKEN_ENC_KEY (32 bytes as 64 hex chars or base64), so this service can read the credential blobs
// the flagship admin stores in tenant_messaging_senders.

const ALGO = 'aes-256-gcm'
const PREFIX = 'v1'

function loadKey(): Buffer {
  const raw = (process.env.SOCIAL_TOKEN_ENC_KEY ?? '').trim()
  if (!raw) throw new Error('SOCIAL_TOKEN_ENC_KEY is not set — required to read tenant sender credentials')
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error(`SOCIAL_TOKEN_ENC_KEY must decode to 32 bytes (got ${key.length})`)
  return key
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, loadKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptToken(encoded: string): string {
  const parts = encoded.split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('decryptToken: unrecognized ciphertext format')
  const [, iv, tag, ct] = parts
  const decipher = crypto.createDecipheriv(ALGO, loadKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}
