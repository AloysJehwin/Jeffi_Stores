import { generateSecret, generateURI, verify } from 'otplib'
import { SignJWT, jwtVerify } from 'jose'
import crypto from 'crypto'

const ALG = 'aes-256-gcm'
const ISSUER = 'Jeffi Stores Admin'
const TICKET_TTL = '5m'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}
const TICKET_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

export type MfaPurpose = 'enroll' | 'verify'

export interface MfaTicketPayload {
  adminId: string
  username: string
  purpose: MfaPurpose
  [key: string]: any
}

export async function issueMfaTicket(payload: MfaTicketPayload): Promise<string> {
  return new SignJWT({ ...payload, type: 'mfa_ticket' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TICKET_TTL)
    .sign(TICKET_SECRET)
}

export async function verifyMfaTicket(token: string, expectedPurpose: MfaPurpose): Promise<MfaTicketPayload | null> {
  try {
    const { payload } = await jwtVerify(token, TICKET_SECRET)
    if (payload.type !== 'mfa_ticket') return null
    if (payload.purpose !== expectedPurpose) return null
    if (!payload.adminId || typeof payload.adminId !== 'string') return null
    return payload as MfaTicketPayload
  } catch (err) {
    console.error('[route]', err)
    return null
  }
}

function getKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY
  if (!raw) throw new Error('MFA_ENCRYPTION_KEY not set')
  const buf = raw.length === 64 ? Buffer.from(raw, 'hex') : crypto.createHash('sha256').update(raw).digest()
  if (buf.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must derive to 32 bytes')
  return buf
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALG, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

export function decryptSecret(payload: string): string {
  const [ivB, tagB, encB] = payload.split('.')
  if (!ivB || !tagB || !encB) throw new Error('malformed mfa payload')
  const decipher = crypto.createDecipheriv(ALG, getKey(), Buffer.from(ivB, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()])
  return dec.toString('utf8')
}

export async function generateTotpSecret(): Promise<string> {
  return await generateSecret()
}

export async function buildOtpauthUrl(username: string, secret: string): Promise<string> {
  return await generateURI({ secret, label: username, issuer: ISSUER })
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!code || !/^\d{6}$/.test(code.trim())) return false
  try {
    const result = await verify({ token: code.trim(), secret, epochTolerance: 30 })
    return !!result.valid
  } catch (err) {
    console.error('[route]', err)
    return false
  }
}

export function generateRecoveryCodes(count = 10): { plain: string; hash: string }[] {
  const out: { plain: string; hash: string }[] = []
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase()
    const plain = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`
    const hash = hashRecoveryCode(plain)
    out.push({ plain, hash })
  }
  return out
}

export function hashRecoveryCode(plain: string): string {
  const pepper = process.env.RECOVERY_CODE_PEPPER || process.env.JWT_SECRET || ''
  return crypto.createHmac('sha256', pepper).update(plain.trim().toUpperCase()).digest('hex')
}
