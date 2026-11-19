import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/auth/otp'
import { sendOwnerOTPEmail } from '@/lib/shared/ecom-emails'
import { controlPlanePool } from '@/lib/tenant-registry'

// Ecom OWNER send-otp. Reuses the shared OTP lib (Redis-backed, rate-limited); the code goes out as Jeffi Commerce.
// Owner-agnostic to signup vs signin — findOrCreateOwner upserts on verify, so the same OTP works for a new or
// returning owner.

// A name as people write one (any script): no digits, links or addresses go into the greeting.
const NAME_RE = /^\p{L}[\p{L}\p{M} .'-]{0,59}$/u

/** The name to greet: what the sign-up form sent, else the owner's saved name. */
async function greetingName(email: string, typed: unknown): Promise<string | null> {
  const name = typeof typed === 'string' ? typed.trim().replace(/\s+/g, ' ') : ''
  if (NAME_RE.test(name)) return name
  const r = await controlPlanePool()
    .query<{ name: string | null }>(`SELECT name FROM owners WHERE lower(email) = lower($1) LIMIT 1`, [email])
    .catch(() => null)
  const saved = r?.rows[0]?.name?.trim()
  return saved || null
}

export async function POST(request: NextRequest) {
  try {
    const { email, name } = await request.json()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }
    const rl = await checkSendOtpRateLimit(email)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Please wait ${rl.retryAfter}s before requesting another OTP.`, retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
    const otp = generateOTP()
    await storeOTP(email, otp)
    const sent = await sendOwnerOTPEmail(email, otp, await greetingName(email, name))
    if (!sent.success) return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
    await recordSendOtp(email)
    return NextResponse.json({ message: 'OTP sent', email: email.toLowerCase(), nextCooldown: rl.nextCooldown })
  } catch {
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}
