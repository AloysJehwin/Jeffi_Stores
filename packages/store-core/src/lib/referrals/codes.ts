import crypto from 'crypto'
import { queryOne } from '@/lib/shared/db'
import { eligibleCustomerSql } from '@/lib/loyalty/reconcile'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_RE = /^[A-Z0-9]{4,16}$/
const MAX_ATTEMPTS = 5

// A name prefix makes the code feel personal ("ASHA7K2Q"); the random tail keeps it unguessable.
function makeCode(firstName: string | null): string {
  const prefix = (firstName ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'JOIN'
  let tail = ''
  for (const byte of crypto.randomBytes(4)) tail += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return prefix + tail
}

export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return CODE_RE.test(code) ? code : null
}

// One code per customer, created the first time it is needed. Two tabs racing here both end up
// with the same row: the unique referrer constraint turns the loser's insert into a no-op.
export async function getOrCreateReferralCode(userId: string): Promise<string | null> {
  const existing = await queryOne<{ referral_code: string }>(
    `SELECT referral_code FROM referrals WHERE referrer_user_id = $1`,
    [userId]
  )
  if (existing) return existing.referral_code

  const user = await queryOne<{ first_name: string | null }>(
    `SELECT u.first_name FROM users u WHERE u.id = $1 AND ${eligibleCustomerSql('u')}`,
    [userId]
  )
  if (!user) return null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await queryOne(
      `INSERT INTO referrals (referrer_user_id, referral_code, status)
       VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING`,
      [userId, makeCode(user.first_name)]
    )
    const row = await queryOne<{ referral_code: string }>(
      `SELECT referral_code FROM referrals WHERE referrer_user_id = $1`,
      [userId]
    )
    if (row) return row.referral_code
  }
  return null
}

export interface ResolvedReferral {
  referralId: string
  referrerUserId: string
  referrerFirstName: string | null
}

export async function resolveReferralCode(raw: unknown): Promise<ResolvedReferral | null> {
  const code = normalizeReferralCode(raw)
  if (!code) return null
  const row = await queryOne<{ id: string; referrer_user_id: string; first_name: string | null }>(
    `SELECT r.id::text AS id, r.referrer_user_id::text AS referrer_user_id, u.first_name
     FROM referrals r JOIN users u ON u.id = r.referrer_user_id
     WHERE r.referral_code = $1 AND r.status = 'active' AND ${eligibleCustomerSql('u')}`,
    [code]
  )
  return row ? { referralId: row.id, referrerUserId: row.referrer_user_id, referrerFirstName: row.first_name } : null
}
