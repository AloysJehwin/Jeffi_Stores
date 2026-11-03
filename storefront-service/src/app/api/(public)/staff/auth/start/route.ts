import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/auth/otp'
import { sendAdminOTPEmail } from '@/lib/email'
import { resolveAdminByEmail } from '@/lib/auth/admin-identity'
import { hasPlanScope } from '@/lib/auth/plan-gate'
import { staffOtpKey } from '@/lib/auth/staff-auth'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Staff capture form sign-in (no client certificate): a registered, active admin of THIS store
// whose role + plan allow customer notes gets a one-time code by email.
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json().catch(() => ({}))
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }
    const key = staffOtpKey(email)
    const rate = await checkSendOtpRateLimit(key)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Please wait before requesting another code.', retryAfter: rate.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
      )
    }
    const admin = await resolveAdminByEmail(email)
    if (!admin) return NextResponse.json({ error: 'No admin account found for this email.' }, { status: 404 })
    if (!(await hasPlanScope(admin.role, admin.scopes, 'customers:write'))) {
      return NextResponse.json({ error: 'This account cannot add customer notes.' }, { status: 403 })
    }
    const otp = generateOTP()
    await storeOTP(key, otp)
    await sendAdminOTPEmail(email, otp, admin.first_name || undefined)
    await recordSendOtp(key)
    return NextResponse.json({
      message: 'A verification code has been sent to your email.',
      nextCooldown: rate.nextCooldown,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
