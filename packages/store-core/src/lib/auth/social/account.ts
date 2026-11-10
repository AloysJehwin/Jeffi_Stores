import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/auth/issue-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'
import { query, queryOne } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'
import { uploadAvatarImage } from '@/lib/shared/s3'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { POLICY_VERSION } from '@/lib/legals/policies'
import { formatDob, normalizeDob } from '@/lib/shared/format'
import { deleteOTP, isOTPVerified } from '@/lib/auth/otp'
import { attributeReferral } from '@/lib/referrals/attribute'
import { clearReferralCookie, readReferralCookie } from '@/lib/referrals/cookie'
import { SOCIAL_LABEL, type SocialPortal, type SocialProfile, type SocialProvider } from './types'

// Account side of customer social sign-in. Mirrors /api/auth/google and /api/business/google:
// the same lookups, session cookies, activity log, avatar copy and guest-cart merge.

/** The email we may match an existing account on: only one the provider vouches for. */
const linkEmail = (p: SocialProfile) => (p.email && p.emailVerified ? p.email.toLowerCase() : null)

const MATCH = `(
    EXISTS (SELECT 1 FROM user_oauth_identities i WHERE i.user_id = u.id AND i.provider = $1 AND i.subject = $2)
    OR ($1 = 'google' AND u.google_id = $2)
    OR ($3::text IS NOT NULL AND u.email = $3)
  )`

export async function findSocialUser(portal: SocialPortal, provider: SocialProvider, profile: SocialProfile): Promise<any | null> {
  const args = [provider, profile.subject, linkEmail(profile)]
  if (portal === 'business') {
    return queryOne<any>(
      `SELECT u.*, bp.approval_status, bp.company_name FROM users u
       LEFT JOIN business_profiles bp ON bp.user_id = u.id
       WHERE ${MATCH} AND u.user_type = 'business' LIMIT 1`,
      args
    )
  }
  // A business user signing in on the store uses their existing account, as with Google.
  return (
    (await queryOne<any>(`SELECT u.* FROM users u WHERE ${MATCH} AND u.user_type != 'business' LIMIT 1`, args)) ??
    (await queryOne<any>(`SELECT u.* FROM users u WHERE ${MATCH} AND u.user_type = 'business' LIMIT 1`, args))
  )
}

export async function linkIdentity(userId: string, provider: SocialProvider, profile: SocialProfile, user?: any): Promise<void> {
  await query(
    `INSERT INTO user_oauth_identities (user_id, provider, subject, email, last_login_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (provider, subject, user_id) DO UPDATE SET last_login_at = NOW(), email = COALESCE(EXCLUDED.email, user_oauth_identities.email)`,
    [userId, provider, profile.subject, profile.email]
  )
  // users.google_id stays the source for the platform Google flow.
  if (provider === 'google' && user && !user.google_id) {
    await query('UPDATE users SET google_id = $1, auth_provider = $2 WHERE id = $3', [profile.subject, 'google', userId]).catch(() => {})
  }
}

async function copyAvatar(userId: string, picture: string | null, onlyIfNotCustom: boolean): Promise<void> {
  if (!picture) return
  try {
    const imgRes = await fetch(picture, { signal: AbortSignal.timeout(8000) })
    if (!imgRes.ok) return
    const { url, s3Key } = await uploadAvatarImage(Buffer.from(await imgRes.arrayBuffer()), userId)
    await query(
      `UPDATE users SET avatar_url = $1, avatar_s3_key = $2 WHERE id = $3${onlyIfNotCustom ? ' AND avatar_is_custom = false' : ''}`,
      [url, s3Key, userId]
    )
  } catch {}
}

async function mergeGuestCart(userId: string): Promise<void> {
  const guestSessionId = (await cookies()).get('session_id')?.value
  if (!guestSessionId?.startsWith('guest_')) return
  const guestUser = await queryOne<any>('SELECT id FROM users WHERE session_id = $1 AND is_guest = true', [guestSessionId])
  if (guestUser) await query('SELECT merge_guest_cart_to_user($1, $2)', [guestUser.id, userId]).catch(() => {})
}

async function issueCookies(
  request: NextRequest,
  user: { id: string; email: string },
  kind: 'customer' | 'business',
  approvalStatus?: string
): Promise<void> {
  const signals = extractSessionSignals(request)
  const { sid } = await issueUserToken({
    userId: user.id,
    email: user.email,
    type: kind,
    ...(kind === 'business' ? { extraClaims: { isBusiness: true, approvalStatus } } : {}),
    userAgent: signals.userAgent,
    ip: signals.ip,
    acceptLanguage: signals.acceptLanguage,
    uaPlatform: signals.uaPlatform,
    fpHash: signals.fpHash,
  })
  const cookieStore = await cookies()
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: USER_SESSION_TTL_S,
    path: '/',
    ...cookieDomainOption(request.headers.get('x-forwarded-host') ?? request.headers.get('host')),
  }
  cookieStore.set(kind === 'business' ? 'business_sid' : 'user_sid', sid, opts)
  cookieStore.set('session_id', user.id, opts)
}

export type SocialSignInResult = { status: 'signed_in' } | { status: 'inactive' } | { status: 'approval'; approvalStatus: string }

/** Sign an existing user in after the provider vouched for them. */
export async function signInSocialUser(
  request: NextRequest,
  portal: SocialPortal,
  provider: SocialProvider,
  profile: SocialProfile,
  user: any
): Promise<SocialSignInResult> {
  if (!user.is_active) return { status: 'inactive' }
  const label = SOCIAL_LABEL[provider]
  await linkIdentity(user.id, provider, profile, user)
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])
  logActivity({
    userId: user.id,
    kind: 'login',
    summary: portal === 'business' ? `Business login via ${label}` : `Logged in via ${label}`,
    metadata: { provider },
  }).catch(() => {})

  if (portal === 'business') {
    const approvalStatus = user.approval_status || 'pending'
    if (approvalStatus !== 'approved') return { status: 'approval', approvalStatus }
    await issueCookies(request, user, 'business', 'approved')
    return { status: 'signed_in' }
  }

  await copyAvatar(user.id, profile.picture, true)
  await mergeGuestCart(user.id)
  await issueCookies(request, user, 'customer')
  return { status: 'signed_in' }
}

export interface SocialSignupInput {
  firstName?: unknown
  lastName?: unknown
  phone?: unknown
  dateOfBirth?: unknown
  email?: unknown
  companyName?: unknown
  gstNumber?: unknown
  businessAddress?: unknown
  industry?: unknown
}

export type SocialSignupResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }

const fail = (status: number, error: string): SocialSignupResult => ({ ok: false, status, error })
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Create the account once the sign-up form supplied what the provider could not. */
export async function completeSocialSignup(
  request: NextRequest,
  portal: SocialPortal,
  provider: SocialProvider,
  profile: SocialProfile,
  input: SocialSignupInput
): Promise<SocialSignupResult> {
  const label = SOCIAL_LABEL[provider]
  const business = portal === 'business'
  const firstName = text(input.firstName)
  const lastName = text(input.lastName)
  if (!firstName) return fail(400, 'First name is required')

  const companyName = text(input.companyName)
  const gstNumber = text(input.gstNumber)
  const businessAddress = text(input.businessAddress)
  const industry = text(input.industry)
  if (business && (!companyName || !gstNumber || !businessAddress || !industry)) return fail(400, 'All business fields are required')

  const digits = String(input.phone || '').replace(/\D/g, '')
  const cleanedPhone = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
  if (cleanedPhone.length !== 10) return fail(400, 'Enter a valid 10-digit mobile number')

  const normalizedDob = normalizeDob(input.dateOfBirth)
  if (!normalizedDob) return fail(400, 'Enter a valid date of birth')

  // An address the provider did not vouch for is typed in and proven by email OTP; it never links.
  const vouched = linkEmail(profile)
  const email = vouched ?? text(input.email).toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) return fail(400, 'Enter a valid email address')
  if (!vouched && !(await isOTPVerified(email))) return fail(400, 'Please verify your email address first')

  const existing = await queryOne<{ id: string }>(
    business
      ? `SELECT u.id FROM users u WHERE u.user_type = 'business' AND (u.email = $3
           OR ($1 = 'google' AND u.google_id = $2)
           OR EXISTS (SELECT 1 FROM user_oauth_identities i WHERE i.user_id = u.id AND i.provider = $1 AND i.subject = $2)) LIMIT 1`
      : `SELECT u.id FROM users u WHERE (u.email = $3
           OR ($1 = 'google' AND u.google_id = $2)
           OR EXISTS (SELECT 1 FROM user_oauth_identities i WHERE i.user_id = u.id AND i.provider = $1 AND i.subject = $2)) LIMIT 1`,
    [provider, profile.subject, email]
  )
  if (existing) {
    return fail(409, business ? 'A business account with this email already exists' : 'An account with this email already exists. Please sign in.')
  }

  let user: any
  try {
    user = await queryOne<any>(
      `INSERT INTO users (email, first_name, last_name, phone, is_active, auth_provider, google_id, user_type,
                          last_login, policies_accepted_version, policies_accepted_at, date_of_birth)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, NOW(), $8, NOW(), $9)
       RETURNING *`,
      [
        email,
        firstName,
        lastName || null,
        cleanedPhone,
        provider,
        provider === 'google' ? profile.subject : null,
        business ? 'business' : 'customer',
        POLICY_VERSION,
        normalizedDob,
      ]
    )
  } catch (err: any) {
    if (err?.code === '23505') return fail(409, 'This email or mobile number is already in use by another account.')
    throw err
  }
  if (!user) return fail(500, 'Failed to create account')
  if (!vouched) await deleteOTP(email).catch(() => {})
  await linkIdentity(user.id, provider, profile)

  if (business) {
    await query(
      `INSERT INTO business_profiles (user_id, company_name, gst_number, business_address, industry)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, companyName, gstNumber.toUpperCase(), businessAddress, industry]
    )
    logActivity({
      userId: user.id,
      kind: 'signup',
      summary: `Business account created via ${label}`,
      metadata: { provider, companyName },
    }).catch(() => {})
    createAdminNotification({
      type: 'b2b_signup_pending',
      category: 'b2b',
      title: 'New B2B account awaiting approval',
      message: `${companyName} (${email})`,
      link: `/admin/business/customers/${user.id}`,
      entityType: 'business_user',
      entityId: String(user.id),
      severity: 'warning',
      scope: 'business_customers:read',
    }).catch(() => {})
    await issueCookies(request, user, 'business', 'pending')
    return {
      ok: true,
      body: {
        message: 'Business account created successfully',
        approvalStatus: 'pending',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          phoneVerified: user.phone_verified ?? false,
        },
      },
    }
  }

  logActivity({ userId: user.id, kind: 'signup', summary: `Signed up via ${label}`, metadata: { provider } }).catch(() => {})
  await copyAvatar(user.id, profile.picture, false)
  await mergeGuestCart(user.id)

  const referralCode = readReferralCookie(request)
  if (referralCode) {
    await attributeReferral({ newUserId: user.id, code: referralCode, fpHash: extractSessionSignals(request).fpHash })
    clearReferralCookie(await cookies())
  }
  await issueCookies(request, user, 'customer')
  return {
    ok: true,
    body: {
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        phoneVerified: user.phone_verified ?? false,
        dateOfBirth: formatDob(user.date_of_birth),
      },
    },
  }
}
