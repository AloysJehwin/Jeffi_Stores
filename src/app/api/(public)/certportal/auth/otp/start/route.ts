import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/auth/otp'
import { sendAdminOTPEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const certPortalOtpKey = (email: string) => `certportal:${email.toLowerCase()}`

// Email-code alternative to Google for certificate.jeffistores.in. Any address may request a
// code (proving ownership is the whole point); the portal then lists only the certificates issued
// to that exact email, so an address with none sees an empty list.
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json().catch(() => ({}))
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }
    const key = certPortalOtpKey(email)
    const rate = await checkSendOtpRateLimit(key)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Please wait before requesting another code.', retryAfter: rate.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
      )
    }
    const otp = generateOTP()
    await storeOTP(key, otp)
    await sendAdminOTPEmail(email, otp)
    await recordSendOtp(key)
    return NextResponse.json({
      message: 'A verification code has been sent to your email.',
      nextCooldown: rate.nextCooldown,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
