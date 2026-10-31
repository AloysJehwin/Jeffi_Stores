import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { generateOTP, storePhoneOTP, checkSendPhoneOtpRateLimit, recordSendPhoneOtp } from '@/lib/auth/otp'
import { deliverPhoneOtp } from '@/lib/auth/phone-otp-delivery'
import { queryOne } from '@/lib/shared/db'

function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
  return cleaned.length === 10 ? cleaned : null
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateAnyUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { phone } = await request.json()
    const cleaned = normalizeIndianPhone(String(phone || ''))
    if (!cleaned) {
      return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
    }

    const taken = await queryOne(
      `SELECT id FROM users
        WHERE phone = $1 AND phone_verified = true AND user_type != 'business' AND id <> $2
        LIMIT 1`,
      [cleaned, authUser.userId]
    )
    if (taken) {
      return NextResponse.json({ error: 'This mobile number is already in use by another account.' }, { status: 409 })
    }

    const rateLimit = await checkSendPhoneOtpRateLimit(cleaned)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Please wait ${rateLimit.retryAfter}s before requesting another OTP.`,
          retryAfter: rateLimit.retryAfter,
        },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    const otp = generateOTP()
    await storePhoneOTP(cleaned, otp)

    // WhatsApp first, then SMS, then the account's email (see deliverPhoneOtp).
    const account = await queryOne<{ email: string | null; first_name: string | null }>(
      `SELECT email, first_name FROM users WHERE id = $1`,
      [authUser.userId]
    )
    const channel = await deliverPhoneOtp({ phone: cleaned, otp, email: account?.email, name: account?.first_name })
    if (!channel) {
      return NextResponse.json({ error: 'Failed to send OTP. Please try again.' }, { status: 500 })
    }

    await recordSendPhoneOtp(cleaned)

    return NextResponse.json({ message: 'OTP sent', channel, nextCooldown: rateLimit.nextCooldown })
  } catch {
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}
