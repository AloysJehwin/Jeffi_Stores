import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/otp'
import { sendOTPEmail } from '@/lib/email'

// Ecom OWNER send-otp. Reuses the shared OTP lib (Redis-backed, rate-limited) +
// email sender. Owner-agnostic to signup vs signin — findOrCreateOwner upserts on
// verify, so the same OTP works for a new or returning owner.
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }
    const rl = await checkSendOtpRateLimit(email)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Please wait ${rl.retryAfter}s before requesting another OTP.`, retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    const otp = generateOTP()
    await storeOTP(email, otp)
    const sent = await sendOTPEmail(email, otp)
    if (!sent.success) return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
    await recordSendOtp(email)
    return NextResponse.json({ message: 'OTP sent', email: email.toLowerCase(), nextCooldown: rl.nextCooldown })
  } catch {
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}
