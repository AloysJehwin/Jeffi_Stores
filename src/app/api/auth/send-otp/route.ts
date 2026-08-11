import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/otp'
import { sendOTPEmail } from '@/lib/email'
import { sendOTPSMS } from '@/lib/sms'
import { sendOTPWhatsApp } from '@/lib/whatsapp'
import { queryOne } from '@/lib/db'
import { POLICY_VERSION } from '@/app/legal/policies'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, isSignup, userType, phone, channel } = body

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const resolvedChannel: string = channel || 'email'
    if (['sms', 'whatsapp'].includes(resolvedChannel) && !phone) {
      return NextResponse.json({ error: 'Phone number is required for SMS/WhatsApp OTP' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }

    const rateLimit = await checkSendOtpRateLimit(email)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Please wait ${rateLimit.retryAfter}s before requesting another OTP.`,
          retryAfter: rateLimit.retryAfter,
        },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }

    let requiresPolicyAcceptance = false

    if (isSignup) {
      const existingUser = await queryOne(
        userType === 'business'
          ? "SELECT id FROM users WHERE email = $1 AND user_type = 'business'"
          : "SELECT id FROM users WHERE email = $1 AND user_type != 'business'",
        [email.toLowerCase()]
      )

      if (existingUser) {
        return NextResponse.json({ error: 'Email already registered', userExists: true }, { status: 400 })
      }
      requiresPolicyAcceptance = true
    } else {
      const existingUser = await queryOne(
        userType === 'business'
          ? "SELECT id, first_name, policies_accepted_version FROM users WHERE email = $1 AND user_type = 'business'"
          : "SELECT id, first_name, policies_accepted_version FROM users WHERE email = $1 AND user_type != 'business'",
        [email.toLowerCase()]
      )

      if (!existingUser) {
        return NextResponse.json({ error: 'No account found with this email. Please sign up first.', userNotFound: true }, { status: 404 })
      }
      requiresPolicyAcceptance = existingUser.policies_accepted_version !== POLICY_VERSION
    }

    const otp = generateOTP()
    await storeOTP(email, otp)

    let sendResult: { success: boolean }
    if (resolvedChannel === 'sms') {
      const ok = await sendOTPSMS({ phone, otp })
      sendResult = { success: ok }
    } else if (resolvedChannel === 'whatsapp') {
      const ok = await sendOTPWhatsApp({ phone, otp })
      sendResult = { success: ok }
    } else {
      sendResult = await sendOTPEmail(email, otp)
    }

    if (!sendResult.success) {
      return NextResponse.json(
        { error: `Failed to send OTP via ${resolvedChannel}. Please try again.` },
        { status: 500 }
      )
    }

    await recordSendOtp(email)

    return NextResponse.json({
      message: `OTP sent successfully via ${resolvedChannel}`,
      email: email.toLowerCase(),
      nextCooldown: rateLimit.nextCooldown,
      requiresPolicyAcceptance,
      policyVersion: POLICY_VERSION,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}
