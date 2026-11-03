import 'server-only'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import redis from '@/lib/shared/redis'
import { query, queryOne } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import { sendByTemplate } from '@/lib/shared/send-by-template'
import { logMessage } from '@/lib/shared/message-log'
import { normalizePhoneE164 } from '@/lib/google-ads/conversions/hash'

// An admin's mobile number, verified by a code sent on WhatsApp (else SMS). Needed before a certificate
// download, and it is the number the admin assistant answers on WhatsApp. The store's admins row holds
// it; the control plane's admin_mobiles maps the number back to the store for inbound WhatsApp.
// Codes are sent and billed as the platform: a new store's empty wallet must not lock its admins out.

const CODE_TTL_SEC = 600
const MAX_ATTEMPTS = 5
const COOLDOWNS_SEC = [30, 60, 120, 300, 600]
const PER_NUMBER_PER_HOUR = 5
const NO_TENANT = '00000000-0000-0000-0000-000000000000'

/** Which store an admin belongs to: a tenant id, or null for the platform. */
export type AdminStore = string | null

export const normalizeAdminMobile = (raw: string | null | undefined) => normalizePhoneE164(raw)

/** "+91 ••••••4321" */
export function maskMobile(phone: string | null | undefined): string | null {
  if (!phone) return null
  return `${phone.slice(0, Math.max(0, phone.length - 10))} ••••••${phone.slice(-4)}`.trim()
}

const scopeKey = (store: AdminStore) => store ?? 'platform'
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

export interface AdminMobileRow {
  id: string
  mobile: string | null
  mobile_verified_at: string | null
}

/** The active admin for an email in the current store (run inside the store's tenant context). */
export async function activeAdminByEmail(email: string): Promise<AdminMobileRow | null> {
  return queryOne<AdminMobileRow>(
    `SELECT a.id::text, a.mobile, a.mobile_verified_at::text
       FROM admins a JOIN users u ON u.id = a.user_id
      WHERE lower(u.email) = lower($1) AND a.is_active = TRUE
      LIMIT 1`,
    [email]
  )
}

export async function adminMobile(adminId: string): Promise<AdminMobileRow | null> {
  return queryOne<AdminMobileRow>(`SELECT id::text, mobile, mobile_verified_at::text FROM admins WHERE id = $1`, [adminId])
}

type SendResult = { ok: true; channel: 'whatsapp' | 'sms'; retryAfter: number } | { ok: false; error: string; status: number; retryAfter?: number }

/** Sends a code to the number for this admin. The number is only saved once the code is entered. */
export async function sendAdminMobileCode(store: AdminStore, adminId: string, rawPhone: string, storeName: string): Promise<SendResult> {
  const phone = normalizeAdminMobile(rawPhone)
  if (!phone) return { ok: false, error: 'Enter a valid mobile number with its country code, e.g. +91 98765 43210.', status: 400 }
  const taken = await queryOne<{ id: string }>(
    `SELECT id::text FROM admins WHERE mobile = $1 AND mobile_verified_at IS NOT NULL AND id <> $2`,
    [phone, adminId]
  )
  if (taken) return { ok: false, error: 'Another admin of this store already uses this number.', status: 409 }

  const k = scopeKey(store)
  const lastKey = `adminmob:send:${k}:${adminId}`
  const countKey = `adminmob:sends:${k}:${adminId}`
  const numberKey = `adminmob:phone:${phone}`
  const now = Math.floor(Date.now() / 1000)
  const [last, count, perNumber] = await Promise.all([redis.get(lastKey), redis.get(countKey), redis.get(numberKey)])
  const sends = Number(count || 0)
  const wait = sends ? COOLDOWNS_SEC[Math.min(sends - 1, COOLDOWNS_SEC.length - 1)] - (now - Number(last || 0)) : 0
  if (wait > 0) return { ok: false, error: `Wait ${wait}s before asking for another code.`, status: 429, retryAfter: wait }
  if (Number(perNumber || 0) >= PER_NUMBER_PER_HOUR)
    return { ok: false, error: 'Too many codes for this number. Try again in an hour.', status: 429, retryAfter: 3600 }

  const code = String(randomInt(100000, 1000000))
  const channel = await deliver(phone, code, storeName)
  if (!channel) return { ok: false, error: 'The code could not be sent by WhatsApp or SMS. Check the number and try again.', status: 502 }

  await Promise.all([
    redis.set(`adminmob:otp:${k}:${adminId}`, JSON.stringify({ phone, hash: hash(code), attempts: 0 }), 'EX', CODE_TTL_SEC),
    redis.set(lastKey, String(now), 'EX', 3600),
    redis.set(countKey, String(sends + 1), 'EX', 3600),
    redis.set(numberKey, String(Number(perNumber || 0) + 1), 'EX', 3600),
  ])
  return { ok: true, channel, retryAfter: COOLDOWNS_SEC[Math.min(sends, COOLDOWNS_SEC.length - 1)] }
}

async function deliver(phone: string, code: string, storeName: string): Promise<'whatsapp' | 'sms' | null> {
  const attempts: Array<['whatsapp' | 'sms', Record<string, unknown>]> = [
    ['whatsapp', { '1': code }],
    ['sms', { code, ttl_minutes: 10, store_name: storeName }],
  ]
  for (const [channel, variables] of attempts) {
    const r = await sendByTemplate({ channel, slug: 'otp/verify', to: phone, variables, asPlatform: true })
    const ok = r.status !== 'failed' && r.status !== 'skipped'
    logMessage({ channel, to: phone, from: 'messaging-service', body: r.body ?? '[otp/verify]', kind: 'otp', status: ok ? 'sent' : 'failed', error: r.error, providerSid: r.providerSid ?? null, provider: 'messaging-service', entityType: 'admin_mobile' })
    if (ok) return channel
  }
  return null
}

/** Checks the code and, when it matches, saves the number as this admin's verified mobile. */
export async function verifyAdminMobileCode(store: AdminStore, adminId: string, code: string): Promise<{ ok: true; phone: string } | { ok: false; error: string; status: number }> {
  const key = `adminmob:otp:${scopeKey(store)}:${adminId}`
  const raw = await redis.get(key)
  if (!raw) return { ok: false, error: 'The code has expired. Ask for a new one.', status: 400 }
  const pending = JSON.parse(raw) as { phone: string; hash: string; attempts: number }
  const given = Buffer.from(hash(String(code).trim()))
  if (!timingSafeEqual(given, Buffer.from(pending.hash))) {
    const attempts = pending.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      await redis.del(key)
      return { ok: false, error: 'Too many wrong codes. Ask for a new one.', status: 429 }
    }
    const ttl = await redis.ttl(key).catch(() => CODE_TTL_SEC)
    await redis.set(key, JSON.stringify({ ...pending, attempts }), 'EX', Math.max(1, Number(ttl) || CODE_TTL_SEC))
    return { ok: false, error: `That code is not right. ${MAX_ATTEMPTS - attempts} tries left.`, status: 400 }
  }
  await redis.del(key)
  const saved = await setVerifiedMobile(store, adminId, pending.phone)
  return saved.ok ? { ok: true, phone: pending.phone } : saved
}

async function setVerifiedMobile(store: AdminStore, adminId: string, phone: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  try {
    await query(`UPDATE admins SET mobile = $2, mobile_verified_at = now() WHERE id = $1`, [adminId, phone])
  } catch (err: any) {
    if (err?.code === '23505') return { ok: false, error: 'Another admin of this store already uses this number.', status: 409 }
    throw err
  }
  const pool = controlPlanePool()
  await pool.query(
    `DELETE FROM admin_mobiles WHERE phone = $3 AND COALESCE(tenant_id, '${NO_TENANT}'::uuid) = COALESCE($1::uuid, '${NO_TENANT}'::uuid) AND admin_id <> $2::uuid`,
    [store, adminId, phone]
  )
  await pool.query(
    `INSERT INTO admin_mobiles (phone, tenant_id, admin_id, verified_at) VALUES ($3, $1::uuid, $2::uuid, now())
     ON CONFLICT (COALESCE(tenant_id, '${NO_TENANT}'::uuid), admin_id) DO UPDATE SET phone = EXCLUDED.phone, verified_at = now()`,
    [store, adminId, phone]
  )
  return { ok: true }
}

/** Forgets an admin's number (reset by an owner, or the admin deactivated or removed). */
export async function clearAdminMobile(store: AdminStore, adminId: string): Promise<void> {
  await query(`UPDATE admins SET mobile = NULL, mobile_verified_at = NULL WHERE id = $1`, [adminId])
  await controlPlanePool()
    .query(`DELETE FROM admin_mobiles WHERE COALESCE(tenant_id, '${NO_TENANT}'::uuid) = COALESCE($1::uuid, '${NO_TENANT}'::uuid) AND admin_id = $2::uuid`, [store, adminId])
    .catch(err => console.error('[admin-mobile] clear', err))
}
