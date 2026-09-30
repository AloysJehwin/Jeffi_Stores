import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/otp'
import { sendOTPEmail } from '@/lib/email'
import { sendOTPSMS } from '@/lib/sms'
import { sendOTPWhatsApp } from '@/lib/whatsapp'
import { queryOne } from '@/lib/db'
import { POLICY_VERSION } from '@/lib/legals/policies'

function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
  return cleaned.length === 10 ? cleaned : null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { identifier, isSignup, userType, phone, channel } = body
    let { email } = body

    const resolvedChannel: string = channel || 'email'

    // Login can identify an account by email OR verified mobile number. When the
    // supplied identifier is a phone (login-by-phone), resolve it to the account's
    // email so the rest of the flow (OTP store, verify, login) stays email-keyed.
    let deliveryPhone: string | null = phone || null
    if (!isSignup && !email && identifier) {
      const asPhone = normalizeIndianPhone(String(identifier))
      if (asPhone) {
        const byPhone = await queryOne<any>(
          userType === 'business'
            ? "SELECT email, phone FROM users WHERE phone = $1 AND phone_verified = true AND user_type = 'business' LIMIT 1"
            : "SELECT email, phone FROM users WHERE phone = $1 AND phone_verified = true AND user_type != 'business' LIMIT 1",
          [asPhone]
        )
        if (!byPhone) {
          return NextResponse.json(
            { error: 'No account found with this mobile number. Please sign up first.', userNotFound: true },
            { status: 404 }
          )
        }
        email = byPhone.email
        deliveryPhone = deliveryPhone || byPhone.phone
      } else {
        email = String(identifier).trim()
      }
    }

    if (!email) {
      return NextResponse.json({ error: 'Email or mobile number is required' }, { status: 400 })
    }

    if (['sms', 'whatsapp'].includes(resolvedChannel) && !deliveryPhone) {
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
        return NextResponse.json(
          { error: 'No account found with this email. Please sign up first.', userNotFound: true },
          { status: 404 }
        )
      }
      requiresPolicyAcceptance = existingUser.policies_accepted_version !== POLICY_VERSION
    }

    const otp = generateOTP()
    await storeOTP(email, otp)

    let sendResult: { success: boolean }
    if (resolvedChannel === 'sms') {
      const ok = await sendOTPSMS({ phone: deliveryPhone, otp })
      sendResult = { success: ok }
    } else if (resolvedChannel === 'whatsapp') {
      const ok = await sendOTPWhatsApp({ phone: deliveryPhone, otp })
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
      resolvedEmail: email.toLowerCase(),
      nextCooldown: rateLimit.nextCooldown,
      requiresPolicyAcceptance,
      policyVersion: POLICY_VERSION,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}
