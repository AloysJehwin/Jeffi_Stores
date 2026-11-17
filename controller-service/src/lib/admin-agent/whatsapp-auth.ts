import 'server-only'
import crypto from 'crypto'
import redis from '@/lib/shared/redis'
import { queryOne } from '@/lib/shared/db'
import { decryptSecret, verifyTotp } from '@/lib/auth/mfa'
import { sendOTPEmail } from '@/lib/email/auth'

// Admin assistant on WhatsApp: a verified admin mobile is not enough to run the store. Each (store, admin, phone)
// needs a session, opened by the 6-digit code from the admin's authenticator app (the one admin sign-in uses) or,
// without one, a code emailed to the admin's address. Sessions last 8 hours; LOGOUT ends them; 5 wrong codes lock
// sign-in for 15 minutes. The message that triggered the challenge is answered once the code checks out.

const SESSION_S = 8 * 3600
const CHALLENGE_S = 10 * 60
const FAIL_WINDOW_S = 15 * 60
const MAX_FAILS = 5
const LOGOUT = new Set(['LOGOUT', 'LOG OUT', 'SIGN OUT', 'SIGNOUT'])

export type GateResult = { pass: true; resume: string | null; notice: string | null } | { pass: false; reply: string }

interface Challenge {
  pending: string | null
  emailHash?: string
}

const keyOf = (storeKey: string, adminId: string, phone: string) => `${storeKey}:${adminId}:${phone.replace(/\D/g, '')}`
const hash = (code: string) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'adminwa').update(code).digest('hex')
const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, (_, a, b) => `${a}•••${b}`)

async function adminAuth(adminId: string) {
  return queryOne<{ mfa_enabled: boolean; mfa_secret_enc: string | null; email: string | null; first_name: string | null }>(
    `SELECT a.mfa_enabled, a.mfa_secret_enc, u.email, u.first_name FROM admins a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.id = $1 AND a.is_active = true`,
    [adminId]
  )
}

/** Ends every WhatsApp session this phone has (all stores and admins). */
export async function endWhatsAppAdminSessions(phone: string): Promise<void> {
  const d = phone.replace(/\D/g, '')
  const keys = await redis.keys(`adminwa:auth:session:*:${d}`).catch(() => [] as string[])
  if (keys.length) await redis.del(...keys).catch(() => {})
}

export async function whatsappAdminGate(i: { storeKey: string; storeName: string; adminId: string; phone: string; text: string }): Promise<GateResult> {
  const k = keyOf(i.storeKey, i.adminId, i.phone)
  const sessionKey = `adminwa:auth:session:${k}`
  const challengeKey = `adminwa:auth:challenge:${k}`
  const failKey = `adminwa:auth:fail:${k}`
  const text = i.text.trim()

  if (LOGOUT.has(text.toUpperCase())) {
    await endWhatsAppAdminSessions(i.phone)
    await redis.del(challengeKey).catch(() => {})
    return { pass: false, reply: 'Signed out of the admin assistant. Send a message to sign in again.' }
  }
  if (await redis.get(sessionKey)) return { pass: true, resume: null, notice: null }

  const fails = Number(await redis.get(failKey)) || 0
  if (fails >= MAX_FAILS) return { pass: false, reply: 'Too many wrong codes. Try again in 15 minutes.' }

  const admin = await adminAuth(i.adminId)
  if (!admin) return { pass: false, reply: 'Your admin account is not active.' }
  const raw = await redis.get(challengeKey)
  const challenge: Challenge | null = raw ? JSON.parse(raw) : null

  if (challenge && /^\d{6}$/.test(text)) {
    let ok = false
    if (admin.mfa_enabled && admin.mfa_secret_enc) {
      try {
        ok = await verifyTotp(decryptSecret(admin.mfa_secret_enc), text)
      } catch {
        ok = false
      }
    }
    if (!ok && challenge.emailHash) ok = crypto.timingSafeEqual(Buffer.from(hash(text)), Buffer.from(challenge.emailHash))
    if (!ok) {
      const n = await redis.incr(failKey)
      if (n === 1) await redis.expire(failKey, FAIL_WINDOW_S)
      return { pass: false, reply: n >= MAX_FAILS ? 'Too many wrong codes. Try again in 15 minutes.' : "That code didn't work. Send the current 6-digit code." }
    }
    await redis.set(sessionKey, '1', 'EX', SESSION_S)
    await redis.del(challengeKey, failKey).catch(() => {})
    return { pass: true, resume: challenge.pending, notice: `Signed in to ${i.storeName} for 8 hours. Send LOGOUT to sign out.` }
  }

  const pending = /^\d{6}$/.test(text) ? challenge?.pending ?? null : text || challenge?.pending || null
  if (admin.mfa_enabled && admin.mfa_secret_enc) {
    await redis.set(challengeKey, JSON.stringify({ pending } satisfies Challenge), 'EX', CHALLENGE_S)
    return { pass: false, reply: `To use the ${i.storeName} admin assistant here, send the 6-digit code from your authenticator app. You stay signed in for 8 hours.` }
  }
  if (!admin.email) return { pass: false, reply: 'Turn on two-step sign-in in the admin panel (Profile → Security) to use the assistant on WhatsApp.' }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  await redis.set(challengeKey, JSON.stringify({ pending, emailHash: hash(code) } satisfies Challenge), 'EX', CHALLENGE_S)
  await sendOTPEmail(admin.email, code, admin.first_name ?? undefined).catch(err => console.error('[admin-whatsapp] code email', err))
  return { pass: false, reply: `We emailed a 6-digit code to ${maskEmail(admin.email)}. Send it here to sign in for 8 hours.` }
}
