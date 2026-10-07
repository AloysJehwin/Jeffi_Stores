import { queryOne } from '@/lib/shared/db'
import { eligibleCustomerSql } from '@/lib/loyalty/reconcile'
import { resolveReferralCode } from './codes'
import { isReferralLive } from './settings'

export type RejectReason = 'self' | 'same_phone' | 'same_email' | 'same_device'

export type AttributionResult =
  | { status: 'joined'; referrerUserId: string }
  | { status: 'rejected'; reason: RejectReason }
  | { status: 'skipped'; reason: 'disabled' | 'invalid_code' | 'not_eligible' | 'already_referred' | 'error' }

// Gmail ignores dots and anything after a "+", so a.b+ref@gmail.com is the same inbox as ab@gmail.com.
export function normalizeEmailIdentity(email: string | null | undefined): string | null {
  if (!email) return null
  const [rawLocal, rawDomain] = email.trim().toLowerCase().split('@')
  if (!rawLocal || !rawDomain) return null
  let local = rawLocal.split('+')[0]
  let domain = rawDomain
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '')
    domain = 'gmail.com'
  }
  return `${local}@${domain}`
}

function phoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

interface Person {
  id: string
  email: string | null
  phone: string | null
}

async function sameDevice(referrerUserId: string, fpHash: string | null | undefined): Promise<boolean> {
  if (!fpHash) return false
  const row = await queryOne(
    `SELECT 1 FROM auth_sessions
     WHERE principal_type = 'customer' AND principal_id = $1 AND fp_hash = $2
     LIMIT 1`,
    [referrerUserId, fpHash]
  )
  return row !== null
}

async function rejectionFor(referrer: Person, friend: Person, fpHash: string | null | undefined): Promise<RejectReason | null> {
  if (referrer.id === friend.id) return 'self'
  const phone = phoneDigits(friend.phone)
  if (phone && phone === phoneDigits(referrer.phone)) return 'same_phone'
  const email = normalizeEmailIdentity(friend.email)
  if (email && email === normalizeEmailIdentity(referrer.email)) return 'same_email'
  if (await sameDevice(referrer.id, fpHash)) return 'same_device'
  return null
}

// Called once, right after a retail account is created. Records who referred the new customer, or
// why the referral was refused. It must never break signup, so every failure becomes a skip.
export async function attributeReferral(input: {
  newUserId: string
  code: string | null | undefined
  fpHash: string | null | undefined
}): Promise<AttributionResult> {
  try {
    if (!input.code) return { status: 'skipped', reason: 'invalid_code' }
    if (!(await isReferralLive())) return { status: 'skipped', reason: 'disabled' }
    const referral = await resolveReferralCode(input.code)
    if (!referral) return { status: 'skipped', reason: 'invalid_code' }

    const [referrer, friend] = await Promise.all(
      [referral.referrerUserId, input.newUserId].map(id =>
        queryOne<Person>(`SELECT u.id::text AS id, u.email, u.phone FROM users u WHERE u.id = $1 AND ${eligibleCustomerSql('u')}`, [
          id,
        ])
      )
    )
    if (!referrer || !friend) return { status: 'skipped', reason: 'not_eligible' }

    const reason = await rejectionFor(referrer, friend, input.fpHash)
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO referral_signups (referral_id, referrer_user_id, referred_user_id, status, reject_reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (referred_user_id) DO NOTHING
       RETURNING id`,
      [referral.referralId, referrer.id, friend.id, reason ? 'rejected' : 'joined', reason]
    )
    if (!inserted) return { status: 'skipped', reason: 'already_referred' }
    return reason ? { status: 'rejected', reason } : { status: 'joined', referrerUserId: referrer.id }
  } catch (err) {
    console.error('[referrals] attribution failed', err)
    return { status: 'skipped', reason: 'error' }
  }
}
